import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { isDefined } from 'twenty-shared/utils';
import { In, type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { parseBusinessCalendar } from 'src/modules/paryatech-crm/services/agency-contact-control-calendar';
import {
  requiredNumber,
  toAgencyRecord,
  toContactRecord,
  toOutreachEventRecord,
  toSharedExceptionRecord,
  type WorkspaceRecord,
} from 'src/modules/paryatech-crm/services/agency-contact-control-record.mapper';
import {
  PARYATECH_CRM_OBJECT_NAMES,
  REQUIRED_FIELDS_BY_OBJECT,
} from 'src/modules/paryatech-crm/services/agency-contact-control.schema';
import { selectPendingGateRows } from 'src/modules/paryatech-crm/services/agency-pending-gate.selector';
import { UNRESOLVED_EXCEPTION_STATUSES } from 'src/modules/paryatech-crm/services/agency-contact-control.helpers';
import {
  type AgencyContactControlPermission,
  AgencyContactControlStore,
  type AgencyContactControlTransaction,
  type AgencyContactControlTransactionOptions,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

type Schema = Record<
  (typeof PARYATECH_CRM_OBJECT_NAMES)[number],
  { id: string; nameSingular: string }
>;

const PENDING_GATE_QUERY_LIMIT = 200;

@Injectable()
export class TypeOrmAgencyContactControlStore extends AgencyContactControlStore {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly permissionsService: PermissionsService,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
  ) {
    super();
  }

  async getPermission({
    workspaceId,
    userWorkspaceId,
  }: {
    workspaceId: string;
    userWorkspaceId: string;
  }): Promise<AgencyContactControlPermission> {
    const schema = await this.resolveSchema(workspaceId);
    const permissions =
      await this.permissionsService.getUserWorkspacePermissions({
        workspaceId,
        userWorkspaceId,
      });
    const companyPermission = permissions.objectsPermissions[schema.company.id];
    const outreachPermission =
      permissions.objectsPermissions[schema.outreachEvent.id];
    const canUpdateCompany =
      companyPermission?.canReadObjectRecords === true &&
      companyPermission.canUpdateObjectRecords === true;

    return {
      canClaim: canUpdateCompany,
      canRecordOutreach:
        canUpdateCompany && outreachPermission?.canUpdateObjectRecords === true,
      canRelease: canUpdateCompany,
      canTransfer:
        permissions.permissionFlags[PermissionFlagType.WORKSPACE_MEMBERS] ===
          true ||
        permissions.permissionFlags[PermissionFlagType.ROLES] === true,
    };
  }

  async transact<TData>(
    options: AgencyContactControlTransactionOptions,
    operation: (transaction: AgencyContactControlTransaction) => Promise<TData>,
  ): Promise<TData> {
    const schema = await this.resolveSchema(options.workspaceId);
    const authContext = buildSystemAuthContext(options.workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        return dataSource.transaction(
          async (manager: WorkspaceEntityManager) => {
            const companyRepository = this.getRepository(
              manager,
              schema.company.nameSingular,
            );
            const outreachRepository = this.getRepository(
              manager,
              schema.outreachEvent.nameSingular,
            );
            const exceptionRepository = this.getRepository(
              manager,
              schema.sharedException.nameSingular,
            );
            const agencyRow = await companyRepository.findOne({
              where: { id: options.agencyId },
              lock: { mode: 'pessimistic_write' },
            });

            if (!isDefined(agencyRow)) {
              throw new ParyatechCrmException(
                `Agency ${options.agencyId} was not found`,
                ParyatechCrmExceptionCode.AGENCY_NOT_FOUND,
              );
            }

            const contactRow = isDefined(options.contactId)
              ? await this.getRepository(
                  manager,
                  schema.person.nameSingular,
                ).findOne({ where: { id: options.contactId } })
              : null;
            if (isDefined(options.contactId) && !isDefined(contactRow)) {
              throw new ParyatechCrmException(
                `Contact ${options.contactId} was not found`,
                ParyatechCrmExceptionCode.CONTACT_NOT_FOUND,
              );
            }

            const existingOutreachRow = isDefined(options.providerEvidenceKey)
              ? await outreachRepository.findOne({
                  where: {
                    providerEvidenceKey: options.providerEvidenceKey,
                  },
                  lock: { mode: 'pessimistic_write' },
                })
              : null;
            const pendingOutreachRows = await outreachRepository.find({
              where: {
                agencyId: options.agencyId,
                outcome: 'Pending / Unknown',
              },
              order: { pendingExpiresAt: 'ASC', id: 'ASC' },
              take: PENDING_GATE_QUERY_LIMIT + 1,
            });
            const activeOutreachExceptions = await exceptionRepository.find({
              where: {
                capability: 'Outreach',
                status: In([...UNRESOLVED_EXCEPTION_STATUSES]),
              },
              order: { dueAt: 'ASC', id: 'ASC' },
              take: PENDING_GATE_QUERY_LIMIT + 1,
            });

            if (
              pendingOutreachRows.length > PENDING_GATE_QUERY_LIMIT ||
              activeOutreachExceptions.length > PENDING_GATE_QUERY_LIMIT
            ) {
              throw new ParyatechCrmException(
                'Pending outreach gate query reached its safety bound',
                ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
              );
            }

            const pendingEventIds = pendingOutreachRows.map(({ id }) => id);
            const exceptionsForPendingRows =
              pendingEventIds.length === 0
                ? []
                : await exceptionRepository.find({
                    where: {
                      affectedObject: 'outreachEvent',
                      affectedRecordId: In(pendingEventIds),
                    },
                    take: PENDING_GATE_QUERY_LIMIT + 1,
                  });
            const referencedEventIds = activeOutreachExceptions
              .filter(
                ({ affectedObject }) => affectedObject === 'outreachEvent',
              )
              .map(({ affectedRecordId }) => affectedRecordId);
            const referencedOutreachRows =
              referencedEventIds.length === 0
                ? []
                : await outreachRepository.find({
                    where: { id: In(referencedEventIds) },
                    take: PENDING_GATE_QUERY_LIMIT,
                  });
            const {
              pendingOutreachRow: unresolvedPendingOutreachRow,
              pendingExceptionRow: unresolvedPendingExceptionRow,
            } = selectPendingGateRows({
              agencyId: options.agencyId,
              pendingOutreachRows,
              exceptionsForPendingRows,
              activeOutreachExceptions,
              referencedOutreachRows,
            });
            const policyRows = await this.getRepository(
              manager,
              schema.crmOperatingPolicy.nameSingular,
            ).find({
              where: { active: true },
              order: { updatedAt: 'DESC' },
              take: 2,
            });

            if (policyRows.length !== 1) {
              throw new ParyatechCrmException(
                'Exactly one active CRM Operating Policy must be configured',
                ParyatechCrmExceptionCode.INVALID_RESERVATION_POLICY,
              );
            }

            const businessCalendar = parseBusinessCalendar(
              policyRows[0].businessCalendar,
            );

            if (!isDefined(businessCalendar)) {
              throw new ParyatechCrmException(
                'CRM Operating Policy businessCalendar is invalid',
                ParyatechCrmExceptionCode.INVALID_RESERVATION_POLICY,
              );
            }

            const agency = toAgencyRecord(agencyRow);
            const contact = isDefined(contactRow)
              ? toContactRecord(contactRow)
              : null;

            if (isDefined(contact) && contact.companyId !== agency.id) {
              throw new ParyatechCrmException(
                `Contact ${contact.id} does not belong to Agency ${agency.id}`,
                ParyatechCrmExceptionCode.INVALID_OUTREACH_RECONCILIATION,
              );
            }

            const transaction: AgencyContactControlTransaction = {
              agency,
              contact,
              existingOutreach: isDefined(existingOutreachRow)
                ? toOutreachEventRecord(existingOutreachRow)
                : null,
              unresolvedPendingOutreach: isDefined(unresolvedPendingOutreachRow)
                ? toOutreachEventRecord(unresolvedPendingOutreachRow)
                : null,
              unresolvedPendingException: isDefined(
                unresolvedPendingExceptionRow,
              )
                ? toSharedExceptionRecord(unresolvedPendingExceptionRow)
                : null,
              policy: {
                businessCalendar,
                pendingUnknownMaxBusinessDays: requiredNumber(
                  policyRows[0].pendingUnknownMaxBusinessDays,
                  'pendingUnknownMaxBusinessDays',
                ),
                reservationIntervalMinutes: requiredNumber(
                  policyRows[0].reservationIntervalMinutes,
                  'reservationIntervalMinutes',
                ),
              },
              createOutreachEvent: async (outreachEvent) =>
                toOutreachEventRecord(
                  await outreachRepository.save(outreachEvent),
                ),
              updateOutreachEvent: async (id, patch) => {
                await outreachRepository.update(id, patch);
                return toOutreachEventRecord(
                  await outreachRepository.findOneByOrFail({ id }),
                );
              },
              updateAgency: async (patch) => {
                await companyRepository.update(options.agencyId, patch);
                Object.assign(agency, patch);
                return agency;
              },
              createPendingException: async (pendingException) => {
                await exceptionRepository.save(pendingException);
              },
              resolvePendingException: async (
                outreachEventId,
                evidence,
                resolvedAt,
              ) => {
                await exceptionRepository.update(
                  {
                    affectedObject: 'outreachEvent',
                    affectedRecordId: outreachEventId,
                    status: In([...UNRESOLVED_EXCEPTION_STATUSES]),
                  },
                  {
                    status: 'Resolved',
                    evidence,
                    resolvedAt,
                    resumeReason: 'Provider evidence reconciled',
                    resumedAt: resolvedAt,
                  },
                );
              },
            };

            return operation(transaction);
          },
        );
      },
      authContext,
    );
  }

  async expireReservations({
    workspaceId,
    now,
    batchSize,
  }: {
    workspaceId: string;
    now: Date;
    batchSize: number;
  }): Promise<number> {
    const schema = await this.resolveSchema(workspaceId);
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();

        return dataSource.transaction(
          async (manager: WorkspaceEntityManager) => {
            const companyRepository = this.getRepository(
              manager,
              schema.company.nameSingular,
            );
            const candidates = await companyRepository
              .createQueryBuilder('company')
              .where('company.reservationStatus = :status', {
                status: 'Claimed',
              })
              .andWhere('company.reservationExpiresAt <= :now', { now })
              .orderBy('company.reservationExpiresAt', 'ASC')
              .limit(batchSize)
              .setLock('pessimistic_write')
              .getMany();

            if (candidates.length === 0) {
              return 0;
            }

            const outreachRepository = this.getRepository(
              manager,
              schema.outreachEvent.nameSingular,
            );
            const pendingEvents = await outreachRepository.find({
              where: {
                agencyId: In(candidates.map(({ id }) => id)),
                outcome: 'Pending / Unknown',
              },
            });
            const exceptionRepository = this.getRepository(
              manager,
              schema.sharedException.nameSingular,
            );
            const pendingExceptions =
              pendingEvents.length === 0
                ? []
                : await exceptionRepository.find({
                    where: {
                      affectedObject: 'outreachEvent',
                      affectedRecordId: In(
                        pendingEvents.map(({ id }) => id as string),
                      ),
                      status: In([...UNRESOLVED_EXCEPTION_STATUSES]),
                    },
                  });
            const pendingExceptionEventIds = new Set(
              pendingExceptions.map(({ affectedRecordId }) => affectedRecordId),
            );
            const blockedAgencyIds = new Set(
              pendingEvents
                .filter(({ id }) => pendingExceptionEventIds.has(id))
                .map(({ agencyId }) => agencyId as string),
            );
            const expirableIds = candidates
              .map(({ id }) => id as string)
              .filter((agencyId) => !blockedAgencyIds.has(agencyId));

            if (expirableIds.length === 0) {
              return 0;
            }

            await companyRepository.update(
              { id: In(expirableIds) },
              {
                reservationStatus: 'Expired',
                reservationClaimantId: null,
                reservationExpiresAt: null,
                reservationReleaseReason:
                  'Approved reservation interval elapsed',
              },
            );

            return expirableIds.length;
          },
        );
      },
      authContext,
    );
  }

  private getRepository(
    manager: WorkspaceEntityManager,
    objectNameSingular: string,
  ): WorkspaceRepository<WorkspaceRecord> {
    return manager.getRepository<WorkspaceRecord>(objectNameSingular);
  }

  private async resolveSchema(workspaceId: string): Promise<Schema> {
    const objectMetadata = await this.objectMetadataRepository.find({
      where: {
        workspaceId,
        nameSingular: In([...PARYATECH_CRM_OBJECT_NAMES]),
        isActive: true,
      },
    });
    const metadataByName = Object.fromEntries(
      objectMetadata.map((metadata) => [metadata.nameSingular, metadata]),
    );

    for (const objectName of PARYATECH_CRM_OBJECT_NAMES) {
      if (!isDefined(metadataByName[objectName])) {
        throw new ParyatechCrmException(
          `Required object metadata ${objectName} is missing`,
          ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
        );
      }
    }

    const fieldMetadata = await this.fieldMetadataRepository.find({
      where: {
        objectMetadataId: In(objectMetadata.map(({ id }) => id)),
        isActive: true,
      },
    });
    const fieldNamesByObjectId = fieldMetadata.reduce<Record<string, string[]>>(
      (fieldNames, field) => {
        fieldNames[field.objectMetadataId] = [
          ...(fieldNames[field.objectMetadataId] ?? []),
          field.name,
        ];
        return fieldNames;
      },
      {},
    );

    for (const objectName of PARYATECH_CRM_OBJECT_NAMES) {
      const object = metadataByName[objectName];
      const actualFieldNames = fieldNamesByObjectId[object.id] ?? [];
      const missingField = REQUIRED_FIELDS_BY_OBJECT[objectName].find(
        (fieldName) => !actualFieldNames.includes(fieldName),
      );

      if (isDefined(missingField)) {
        throw new ParyatechCrmException(
          `Required field ${objectName}.${missingField} is missing`,
          ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
        );
      }
    }

    return Object.fromEntries(
      PARYATECH_CRM_OBJECT_NAMES.map((objectName) => [
        objectName,
        {
          id: metadataByName[objectName].id,
          nameSingular: metadataByName[objectName].nameSingular,
        },
      ]),
    ) as Schema;
  }
}
