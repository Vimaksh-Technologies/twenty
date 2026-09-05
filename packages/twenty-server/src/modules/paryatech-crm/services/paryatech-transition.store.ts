import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { In, type Repository } from 'typeorm';

import { ApiKeyRoleService } from 'src/engine/core-modules/api-key/services/api-key-role.service';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { appendGuardedActionReceipt } from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { type GuardedActionIdentity } from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';
import {
  GUARDED_TRANSITION_OBJECT_NAMES,
  GUARDED_TRANSITION_REQUIRED_FIELDS,
} from 'src/modules/paryatech-crm/services/guarded-transition.schema';
import {
  type ParyatechRecord,
  ParyatechTransitionStore,
  type ParyatechTransitionTransaction,
  type ParyatechTransitionTransactionOptions,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

type Schema = Record<
  (typeof GUARDED_TRANSITION_OBJECT_NAMES)[number],
  { id: string; nameSingular: string }
>;

@Injectable()
export class TypeOrmParyatechTransitionStore extends ParyatechTransitionStore {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly userRoleService: UserRoleService,
    private readonly apiKeyRoleService: ApiKeyRoleService,
    @InjectWorkspaceScopedRepository(RoleEntity)
    private readonly roleRepository: WorkspaceScopedRepository<RoleEntity>,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
  ) {
    super();
  }

  async getActorRoleLabel(
    params: GuardedActionIdentity & { workspaceId: string },
  ): Promise<string> {
    if (params.apiKeyId !== undefined) {
      const role = await this.apiKeyRoleService.getRoleDtoByApiKeyId({
        apiKeyId: params.apiKeyId,
        workspaceId: params.workspaceId,
      });

      return role.label;
    }
    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      workspaceId: params.workspaceId,
      userWorkspaceId: params.userWorkspaceId,
    });
    const role = await this.roleRepository.findOne(params.workspaceId, {
      where: { id: roleId },
    });
    if (!role) {
      throw new ParyatechCrmException(
        `Role ${roleId} was not found for this workspace`,
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
    return role.label;
  }

  async transact<TData>(
    options: ParyatechTransitionTransactionOptions,
    operation: (transaction: ParyatechTransitionTransaction) => Promise<TData>,
  ): Promise<TData> {
    const schema = await this.resolveSchema(options.workspaceId);
    const objectName = options.objectName;
    if (!this.isObjectName(objectName)) {
      throw new ParyatechCrmException(
        `Object ${options.objectName} is not in the guarded transition schema`,
        ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
      );
    }
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
        return dataSource.transaction(
          async (manager: WorkspaceEntityManager) => {
            if (options.lockKey) {
              await manager.query(
                'SELECT pg_advisory_xact_lock(hashtext($1))',
                [options.lockKey],
              );
            }
            const primary = options.recordId
              ? await this.getRepository(
                  manager,
                  schema[objectName].nameSingular,
                ).findOne({
                  where: { id: options.recordId },
                  lock: { mode: 'pessimistic_write' },
                })
              : null;
            return operation(
              this.createTransaction(
                manager,
                schema,
                primary,
                options.workspaceId,
              ),
            );
          },
        );
      },
      getWorkspaceAuthContext(),
    );
  }

  private createTransaction(
    manager: WorkspaceEntityManager,
    schema: Schema,
    record: ParyatechRecord | null,
    workspaceId: string,
  ): ParyatechTransitionTransaction {
    return {
      record,
      findOne: async (objectName, where) => {
        const repository = this.repositoryFor(manager, schema, objectName);
        return repository.findOne({ where: where as never });
      },
      findMany: async (objectName, where) => {
        const repository = this.repositoryFor(manager, schema, objectName);
        return repository.find({ where: where as never });
      },
      getRequired: async (objectName, id) => {
        const repository = this.repositoryFor(manager, schema, objectName);
        const relatedRecord = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!relatedRecord) {
          throw new ParyatechCrmException(
            `${objectName} ${id} was not found`,
            ParyatechCrmExceptionCode.RECORD_NOT_FOUND,
          );
        }
        return relatedRecord;
      },
      create: async (objectName, data) => {
        const repository = this.repositoryFor(manager, schema, objectName);
        const record = repository.create(
          data as never,
        ) as unknown as ParyatechRecord;
        return repository.save(record);
      },
      update: async (objectName, id, patch) => {
        const repository = this.repositoryFor(manager, schema, objectName);
        const target = await repository.findOne({
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!target) {
          throw new ParyatechCrmException(
            `${objectName} ${id} was not found`,
            ParyatechCrmExceptionCode.RECORD_NOT_FOUND,
          );
        }
        Object.assign(target, patch);
        return repository.save(target);
      },
      appendGuardedActionReceipt: (receipt) =>
        appendGuardedActionReceipt(manager, workspaceId, receipt),
    };
  }

  private repositoryFor(
    manager: WorkspaceEntityManager,
    schema: Schema,
    objectName: string,
  ) {
    if (!this.isObjectName(objectName)) {
      throw new ParyatechCrmException(
        `Object ${objectName} is not in the guarded transition schema`,
        ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
      );
    }
    return this.getRepository(manager, schema[objectName].nameSingular);
  }

  private getRepository(
    manager: WorkspaceEntityManager,
    objectNameSingular: string,
  ): WorkspaceRepository<ParyatechRecord> {
    return manager.getRepository<ParyatechRecord>(objectNameSingular);
  }

  private isObjectName(
    objectName: string,
  ): objectName is (typeof GUARDED_TRANSITION_OBJECT_NAMES)[number] {
    return GUARDED_TRANSITION_OBJECT_NAMES.some((name) => name === objectName);
  }

  private async resolveSchema(workspaceId: string): Promise<Schema> {
    const objectMetadata = await this.objectMetadataRepository.find({
      where: {
        workspaceId,
        nameSingular: In([...GUARDED_TRANSITION_OBJECT_NAMES]),
        isActive: true,
      },
    });
    const metadataByName = Object.fromEntries(
      objectMetadata.map((metadata) => [metadata.nameSingular, metadata]),
    );
    for (const objectName of GUARDED_TRANSITION_OBJECT_NAMES) {
      if (!isDefined(metadataByName[objectName])) {
        throw this.schemaError(
          `Required object metadata ${objectName} is missing`,
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
    for (const objectName of GUARDED_TRANSITION_OBJECT_NAMES) {
      const object = metadataByName[objectName];
      const actualFields = fieldNamesByObjectId[object.id] ?? [];
      const missingField = GUARDED_TRANSITION_REQUIRED_FIELDS[objectName].find(
        (fieldName) => !actualFields.includes(fieldName),
      );
      if (missingField) {
        throw this.schemaError(
          `Required field ${objectName}.${missingField} is missing`,
        );
      }
    }

    return Object.fromEntries(
      GUARDED_TRANSITION_OBJECT_NAMES.map((objectName) => [
        objectName,
        {
          id: metadataByName[objectName].id,
          nameSingular: metadataByName[objectName].nameSingular,
        },
      ]),
    ) as Schema;
  }

  private schemaError(message: string) {
    return new ParyatechCrmException(
      message,
      ParyatechCrmExceptionCode.SCHEMA_NOT_CONFIGURED,
    );
  }
}
