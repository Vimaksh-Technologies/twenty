import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, type Repository } from 'typeorm';

import { ApiKeyRoleService } from 'src/engine/core-modules/api-key/services/api-key-role.service';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { GUARDED_TRANSITION_REQUIRED_FIELDS } from 'src/modules/paryatech-crm/services/guarded-transition.schema';
import {
  type CommercialCutoverAgreement,
  type CommercialCutoverStoredAgreement,
  ParyatechCommercialCutoverStore,
  type ParyatechCommercialCutoverTransaction,
} from 'src/modules/paryatech-crm/types/commercial-cutover.type';

const CUTOVER_OBJECT_NAMES = [
  'commercialAgreement',
  'company',
  'product',
  'workspaceMember',
] as const;
const CUTOVER_REQUIRED_AGREEMENT_FIELDS = [
  ...GUARDED_TRANSITION_REQUIRED_FIELDS.commercialAgreement,
  'restrictedNotes',
] as const;

type CutoverObjectName = (typeof CUTOVER_OBJECT_NAMES)[number];
type CutoverSchema = Record<
  CutoverObjectName,
  { id: string; nameSingular: string }
>;
type WorkspaceRecord = Record<string, unknown> & { id: string };

type ReceiptRow = {
  actorApiKeyIdHash: string;
  created: boolean;
  evidenceHash: string;
  idempotencyKey: string;
  previous: CommercialCutoverAgreement | null;
  receiptHash: string;
  recordId: string;
  requestHash: string;
  schemaVersion: 'paryatech-commercial-cutover-receipt/v1';
  snapshot: CommercialCutoverAgreement;
  targetHash: string;
};

const relationId = (record: WorkspaceRecord, fieldName: string): string => {
  const directId = record[`${fieldName}Id`];
  if (typeof directId === 'string') {
    return directId;
  }
  const relation = record[fieldName];
  if (
    relation !== null &&
    typeof relation === 'object' &&
    'id' in relation &&
    typeof relation.id === 'string'
  ) {
    return relation.id;
  }
  throw new ParyatechCrmException(
    `Stored Agreement relation ${fieldName} is missing`,
    ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
  );
};

const optionalRelationId = (
  record: WorkspaceRecord,
  fieldName: string,
): string | null => {
  const directId = record[`${fieldName}Id`];
  if (directId === null || directId === undefined) {
    return null;
  }
  return relationId(record, fieldName);
};

const relationIds = (record: WorkspaceRecord, fieldName: string): string[] => {
  const relations = record[fieldName];
  if (!Array.isArray(relations)) {
    return [];
  }
  return relations
    .map((relation) =>
      relation !== null &&
      typeof relation === 'object' &&
      'id' in relation &&
      typeof relation.id === 'string'
        ? relation.id
        : null,
    )
    .filter((id): id is string => id !== null)
    .sort();
};

const stringField = (record: WorkspaceRecord, fieldName: string): string => {
  const value = record[fieldName];
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  throw new ParyatechCrmException(
    `Stored Agreement field ${fieldName} is invalid`,
    ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
  );
};

const nullableStringField = (
  record: WorkspaceRecord,
  fieldName: string,
): string | null => {
  const value = record[fieldName];
  if (value === null || value === undefined) {
    return null;
  }
  return stringField(record, fieldName);
};

const currencyAmount = (record: WorkspaceRecord, fieldName: string): number => {
  const value = record[fieldName];
  if (typeof value === 'number') {
    return value;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    'amountMicros' in value &&
    typeof value.amountMicros === 'number'
  ) {
    return value.amountMicros / 1_000_000;
  }
  throw new ParyatechCrmException(
    `Stored Agreement currency ${fieldName} is invalid`,
    ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
  );
};

const currencyInput = (amount: number, currencyCode: string) => ({
  amountMicros: Math.round(amount * 1_000_000),
  currencyCode,
});
const assertUnchangedPostCutoverFields = (record: WorkspaceRecord): void => {
  const hasExpectedBaseline =
    nullableStringField(record, 'activationConfirmedAt') === null &&
    optionalRelationId(record, 'activationConfirmer') === null &&
    stringField(record, 'activationState') === 'Pending' &&
    nullableStringField(record, 'adoptionEvidence') === null &&
    nullableStringField(record, 'adoptionObservedAt') === null &&
    stringField(record, 'adoptionState') === 'Not Assessed' &&
    nullableStringField(record, 'restrictedNotes') === null &&
    optionalRelationId(record, 'sourceOpportunity') === null;
  if (!hasExpectedBaseline) {
    throw new ParyatechCrmException(
      'Agreement contains post-cutover or restricted changes',
      ParyatechCrmExceptionCode.COMMERCIAL_CUTOVER_CAS_MISMATCH,
    );
  }
};

const snapshotFromRecord = (
  record: WorkspaceRecord,
): CommercialCutoverStoredAgreement => {
  assertUnchangedPostCutoverFields(record);
  return {
    activationConfirmedAt: null,
    activationConfirmer: null,
    activationState: 'Pending',
    adoptionEvidence: null,
    adoptionObservedAt: null,
    adoptionState: 'Not Assessed',
    agency: relationId(record, 'agency'),
    agreementReference: stringField(record, 'agreementReference'),
    amountCollected: currencyAmount(record, 'amountCollected'),
    commercialException: nullableStringField(record, 'commercialException'),
    currency: stringField(record, 'currency'),
    endsAt: stringField(record, 'endsAt'),
    evidenceObservedAt: stringField(record, 'evidenceObservedAt'),
    evidenceRecordedAt: stringField(record, 'evidenceRecordedAt'),
    evidenceSource: stringField(record, 'evidenceSource'),
    evidenceState: stringField(
      record,
      'evidenceState',
    ) as CommercialCutoverAgreement['evidenceState'],
    evidenceType: stringField(record, 'evidenceType'),
    evidenceVerifier: relationId(record, 'evidenceVerifier'),
    grossBooked: currencyAmount(record, 'grossBooked'),
    id: record.id,
    netCollected: currencyAmount(record, 'netCollected'),
    paryatechOsCommercialReference: stringField(
      record,
      'paryatechOsCommercialReference',
    ),
    paymentState: stringField(
      record,
      'paymentState',
    ) as CommercialCutoverAgreement['paymentState'],
    products: relationIds(record, 'products'),
    refundedOrReversedAmount: currencyAmount(
      record,
      'refundedOrReversedAmount',
    ),
    renewalAt: stringField(record, 'renewalAt'),
    renewalNextAction: stringField(record, 'renewalNextAction'),
    renewalNextActionAt: stringField(record, 'renewalNextActionAt'),
    renewalOwner: relationId(record, 'renewalOwner'),
    renewalState: stringField(
      record,
      'renewalState',
    ) as CommercialCutoverAgreement['renewalState'],
    restrictedNotes: null,
    sourceOpportunity: null,
    startsAt: stringField(record, 'startsAt'),
    term: stringField(record, 'term') as CommercialCutoverAgreement['term'],
    waivedAmount: currencyAmount(record, 'waivedAmount'),
  };
};

const persistenceData = (agreement: CommercialCutoverAgreement) => ({
  activationConfirmedAt: null,
  activationConfirmerId: null,
  activationState: agreement.activationState,
  adoptionEvidence: null,
  adoptionObservedAt: null,
  adoptionState: agreement.adoptionState,
  agencyId: agreement.agency,
  agreementReference: agreement.agreementReference,
  amountCollected: currencyInput(agreement.amountCollected, agreement.currency),
  commercialException: agreement.commercialException,
  currency: agreement.currency,
  endsAt: agreement.endsAt,
  evidenceObservedAt: agreement.evidenceObservedAt,
  evidenceRecordedAt: agreement.evidenceRecordedAt,
  evidenceSource: agreement.evidenceSource,
  evidenceState: agreement.evidenceState,
  evidenceType: agreement.evidenceType,
  evidenceVerifierId: agreement.evidenceVerifier,
  grossBooked: currencyInput(agreement.grossBooked, agreement.currency),
  netCollected: currencyInput(agreement.netCollected, agreement.currency),
  paryatechOsCommercialReference: agreement.paryatechOsCommercialReference,
  paymentState: agreement.paymentState,
  products: agreement.products.map((id) => ({ id })),
  refundedOrReversedAmount: currencyInput(
    agreement.refundedOrReversedAmount,
    agreement.currency,
  ),
  renewalAt: agreement.renewalAt,
  renewalNextAction: agreement.renewalNextAction,
  renewalNextActionAt: agreement.renewalNextActionAt,
  renewalOwnerId: agreement.renewalOwner,
  renewalState: agreement.renewalState,
  restrictedNotes: null,
  sourceOpportunityId: null,
  startsAt: agreement.startsAt,
  term: agreement.term,
  waivedAmount: currencyInput(agreement.waivedAmount, agreement.currency),
});

@Injectable()
export class TypeOrmParyatechCommercialCutoverStore extends ParyatechCommercialCutoverStore {
  constructor(
    private readonly apiKeyRoleService: ApiKeyRoleService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
  ) {
    super();
  }

  async getApiKeyRoleLabel({
    apiKeyId,
    workspaceId,
  }: {
    apiKeyId: string;
    workspaceId: string;
  }): Promise<string> {
    return (
      await this.apiKeyRoleService.getRoleDtoByApiKeyId({
        apiKeyId,
        workspaceId,
      })
    ).label;
  }

  async transact<TData>(
    options: {
      apiKeyId: string;
      idempotencyKey: string;
      sourceCommercialId: string;
      workspaceId: string;
    },
    operation: (
      transaction: ParyatechCommercialCutoverTransaction,
    ) => Promise<TData>,
  ): Promise<TData> {
    const schema = await this.resolveSchema(options.workspaceId);
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
        return dataSource.transaction(
          async (manager: WorkspaceEntityManager) => {
            await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
              `paryatech-commercial-cutover:${options.workspaceId}:${options.sourceCommercialId}`,
            ]);
            return operation(
              this.createTransaction(
                manager,
                schema,
                options.workspaceId,
                options.apiKeyId,
              ),
            );
          },
        );
      },
      buildSystemAuthContext(options.workspaceId),
    );
  }

  private createTransaction(
    manager: WorkspaceEntityManager,
    schema: CutoverSchema,
    workspaceId: string,
    apiKeyId: string,
  ): ParyatechCommercialCutoverTransaction {
    const agreementRepository = this.repositoryFor(
      manager,
      schema,
      'commercialAgreement',
    );
    return {
      createAgreement: async (agreement) => {
        await this.lockRelations(manager, schema, agreement);
        const record = agreementRepository.create(
          persistenceData(agreement) as never,
        ) as unknown as WorkspaceRecord;
        return snapshotFromRecord(await agreementRepository.save(record));
      },
      findAgreementForUpdate: async (sourceCommercialId) => {
        const record = await agreementRepository.findOne({
          where: { paryatechOsCommercialReference: sourceCommercialId },
          relations: { products: true } as never,
          lock: { mode: 'pessimistic_write' },
        });
        return record === null ? null : snapshotFromRecord(record);
      },
      findReceiptForUpdate: async (idempotencyKey) => {
        const rows = (await manager.query(
          `SELECT
            "actorApiKeyIdHash", "created", "evidenceHash", "idempotencyKey",
            "previous", "receiptHash", "recordId", "requestHash",
            "schemaVersion", "snapshot", "targetHash"
          FROM "core"."paryatechCommercialCutoverReceipt"
          WHERE "workspaceId" = $1 AND "idempotencyKey" = $2
          FOR UPDATE`,
          [workspaceId, idempotencyKey],
        )) as ReceiptRow[];
        return rows[0] ?? null;
      },
      insertReceipt: async (receipt) => {
        await manager.query(
          `INSERT INTO "core"."paryatechCommercialCutoverReceipt" (
            "workspaceId", "apiKeyId", "actorApiKeyIdHash", "idempotencyKey",
            "requestHash", "targetHash", "evidenceHash", "recordId", "created",
            "previous", "snapshot", "schemaVersion", "receiptHash"
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
            $12, $13
          )`,
          [
            workspaceId,
            apiKeyId,
            receipt.actorApiKeyIdHash,
            receipt.idempotencyKey,
            receipt.requestHash,
            receipt.targetHash,
            receipt.evidenceHash,
            receipt.recordId,
            receipt.created,
            JSON.stringify(receipt.previous),
            JSON.stringify(receipt.snapshot),
            receipt.schemaVersion,
            receipt.receiptHash,
          ],
        );
      },
      updateAgreement: async (recordId, agreement) => {
        await this.lockRelations(manager, schema, agreement);
        const record = await agreementRepository.findOne({
          where: { id: recordId },
          relations: { products: true } as never,
          lock: { mode: 'pessimistic_write' },
        });
        if (record === null) {
          throw new ParyatechCrmException(
            `Commercial Agreement ${recordId} was not found`,
            ParyatechCrmExceptionCode.RECORD_NOT_FOUND,
          );
        }
        Object.assign(record, persistenceData(agreement));
        return snapshotFromRecord(await agreementRepository.save(record));
      },
    };
  }

  private async lockRelations(
    manager: WorkspaceEntityManager,
    schema: CutoverSchema,
    agreement: CommercialCutoverAgreement,
  ) {
    const relationIdsByObject = {
      company: [agreement.agency],
      product: agreement.products,
      workspaceMember: [agreement.evidenceVerifier, agreement.renewalOwner],
    } as const;
    for (const [objectName, recordIds] of Object.entries(
      relationIdsByObject,
    ) as Array<[keyof typeof relationIdsByObject, readonly string[]]>) {
      const repository = this.repositoryFor(manager, schema, objectName);
      const records = await repository.find({
        where: { id: In([...new Set(recordIds)]) } as never,
        lock: { mode: 'pessimistic_read' },
      });
      if (records.length !== new Set(recordIds).size) {
        throw new ParyatechCrmException(
          `Commercial cutover relation ${objectName} is unresolved`,
          ParyatechCrmExceptionCode.RECORD_NOT_FOUND,
        );
      }
    }
  }

  private repositoryFor(
    manager: WorkspaceEntityManager,
    schema: CutoverSchema,
    objectName: CutoverObjectName,
  ): WorkspaceRepository<WorkspaceRecord> {
    return manager.getRepository<WorkspaceRecord>(
      schema[objectName].nameSingular,
    );
  }

  private async resolveSchema(workspaceId: string): Promise<CutoverSchema> {
    const objectMetadata = await this.objectMetadataRepository.find({
      where: {
        workspaceId,
        nameSingular: In([...CUTOVER_OBJECT_NAMES]),
        isActive: true,
      },
    });
    const metadataByName = Object.fromEntries(
      objectMetadata.map((metadata) => [metadata.nameSingular, metadata]),
    );
    for (const objectName of CUTOVER_OBJECT_NAMES) {
      if (!isDefined(metadataByName[objectName])) {
        throw new ParyatechCrmException(
          `Required cutover object ${objectName} is missing`,
          ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
        );
      }
    }
    const agreementMetadata = metadataByName.commercialAgreement;
    const agreementFields = await this.fieldMetadataRepository.find({
      where: { objectMetadataId: agreementMetadata.id, isActive: true },
    });
    const actualFieldNames = agreementFields.map(({ name }) => name);
    const missingField = CUTOVER_REQUIRED_AGREEMENT_FIELDS.find(
      (fieldName) => !actualFieldNames.includes(fieldName),
    );
    if (missingField !== undefined) {
      throw new ParyatechCrmException(
        `Required commercial Agreement field ${missingField} is missing`,
        ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
      );
    }
    return Object.fromEntries(
      CUTOVER_OBJECT_NAMES.map((objectName) => [
        objectName,
        {
          id: metadataByName[objectName].id,
          nameSingular: metadataByName[objectName].nameSingular,
        },
      ]),
    ) as CutoverSchema;
  }
}
