import { buildGuardedActionReceipt } from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';
import {
  type GuardedActionIdentity,
  type GuardedActionReceipt,
} from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';

import {
  type ParyatechRecord,
  ParyatechTransitionStore,
  type ParyatechTransitionTransaction,
  type ParyatechTransitionTransactionOptions,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

export class InMemoryParyatechTransitionStore extends ParyatechTransitionStore {
  roleLabel = 'Paryatech Operator';
  roleIsEditable = true;
  apiKeyRoleLabels = new Map([
    ['support-key', 'Paryatech Support Intake'],
    ['unrelated-key', 'Paryatech Operator'],
  ]);
  records: Record<string, ParyatechRecord[]> = {};
  createdRecords: Array<{ objectName: string; record: ParyatechRecord }> = [];
  guardedActionReceipts: GuardedActionReceipt[] = [];

  async getActorRole(params: GuardedActionIdentity & { workspaceId: string }) {
    return {
      label:
        params.apiKeyId === undefined
          ? this.roleLabel
          : (this.apiKeyRoleLabels.get(params.apiKeyId) ?? ''),
      isEditable: params.apiKeyId === undefined ? this.roleIsEditable : true,
    };
  }

  async transact<TData>(
    options: ParyatechTransitionTransactionOptions,
    operation: (transaction: ParyatechTransitionTransaction) => Promise<TData>,
  ): Promise<TData> {
    const primaryRecord = options.recordId
      ? (this.records[options.objectName]?.find(
          (record) => record.id === options.recordId,
        ) ?? null)
      : null;
    const transaction: ParyatechTransitionTransaction = {
      record: primaryRecord,
      findOne: async (objectName, where) =>
        this.records[objectName]?.find((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ) ?? null,
      findMany: async (objectName, where) =>
        (this.records[objectName] ?? []).filter((record) =>
          Object.entries(where).every(([key, value]) => record[key] === value),
        ),
      getRequired: async (objectName, id) => {
        const record = this.records[objectName]?.find((item) => item.id === id);
        if (!record) {
          throw new Error(`${objectName} ${id} not found`);
        }
        return record;
      },
      create: async (objectName, data) => {
        const record = {
          ...data,
          id: `${objectName}-${(this.records[objectName]?.length ?? 0) + 1}`,
        } as ParyatechRecord;
        this.records[objectName] = [
          ...(this.records[objectName] ?? []),
          record,
        ];
        this.createdRecords.push({ objectName, record });
        return record;
      },
      update: async (objectName, id, patch) => {
        const record = await transaction.getRequired(objectName, id);
        Object.assign(record, patch);
        return record;
      },
      appendGuardedActionReceipt: async (receipt) => {
        this.guardedActionReceipts.push(
          buildGuardedActionReceipt(options.workspaceId, receipt),
        );
      },
    };

    return operation(transaction);
  }
}
