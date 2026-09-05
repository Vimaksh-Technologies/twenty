import {
  type ParyatechRecord,
  ParyatechTransitionStore,
  type ParyatechTransitionTransaction,
  type ParyatechTransitionTransactionOptions,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

export class InMemoryParyatechTransitionStore extends ParyatechTransitionStore {
  roleLabel = 'Paryatech Operator';
  records: Record<string, ParyatechRecord[]> = {};
  createdRecords: Array<{ objectName: string; record: ParyatechRecord }> = [];

  async getActorRoleLabel() {
    return this.roleLabel;
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
    };

    return operation(transaction);
  }
}
