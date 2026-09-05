import { createHash } from 'node:crypto';

import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import {
  type AppendGuardedActionReceiptInput,
  type GuardedActionIdentity,
  type GuardedActionReceipt,
  type GuardedActionState,
  GUARDED_ACTION_ACTOR_TYPE,
} from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';

const SCHEMA_VERSION = 'paryatech-guarded-action-receipt/v1' as const;

const hashValue = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const snapshotGuardedActionState = (
  value: unknown,
): GuardedActionState => {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(snapshotGuardedActionState);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entryValue]) => [
          key,
          snapshotGuardedActionState(entryValue),
        ]),
    );
  }

  throw new TypeError('Guarded action state must be JSON-compatible');
};

const actorFields = (actor: GuardedActionIdentity) =>
  actor.apiKeyId === undefined
    ? {
        actorId: actor.actorWorkspaceMemberId,
        actorType: GUARDED_ACTION_ACTOR_TYPE.HUMAN,
      }
    : {
        actorId: actor.apiKeyId,
        actorType: GUARDED_ACTION_ACTOR_TYPE.API_KEY,
      };

export const buildGuardedActionReceipt = (
  workspaceId: string,
  input: AppendGuardedActionReceiptInput,
): GuardedActionReceipt => {
  const evidenceReference = input.evidenceReference.trim();
  const reason = input.reason.trim();
  const receiptWithoutHash = {
    workspaceId,
    ...actorFields(input.actor),
    action: input.action,
    reason,
    evidenceReference,
    evidenceHash: hashValue(evidenceReference),
    occurredAt: input.occurredAt,
    objectName: input.objectName,
    recordId: input.recordId,
    ownerId: input.ownerId ?? null,
    priorState: input.priorState,
    resultState: input.resultState,
    responseSummary: input.responseSummary?.trim() ?? null,
    schemaVersion: SCHEMA_VERSION,
  };

  return {
    ...receiptWithoutHash,
    receiptHash: hashValue({
      ...receiptWithoutHash,
      occurredAt: input.occurredAt.toISOString(),
    }),
  };
};

export const appendGuardedActionReceipt = async (
  manager: WorkspaceEntityManager,
  workspaceId: string,
  input: AppendGuardedActionReceiptInput,
): Promise<void> => {
  const receipt = buildGuardedActionReceipt(workspaceId, input);

  await manager.query(
    `INSERT INTO "core"."paryatechGuardedActionReceipt" (
      "workspaceId", "actorType", "actorId", "action", "reason",
      "evidenceReference", "evidenceHash", "occurredAt", "objectName",
      "recordId", "ownerId", "priorState", "resultState", "responseSummary",
      "schemaVersion", "receiptHash"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
      $13::jsonb, $14, $15, $16)`,
    [
      receipt.workspaceId,
      receipt.actorType,
      receipt.actorId,
      receipt.action,
      receipt.reason,
      receipt.evidenceReference,
      receipt.evidenceHash,
      receipt.occurredAt,
      receipt.objectName,
      receipt.recordId,
      receipt.ownerId,
      JSON.stringify(receipt.priorState),
      JSON.stringify(receipt.resultState),
      receipt.responseSummary,
      receipt.schemaVersion,
      receipt.receiptHash,
    ],
  );
};

export const reconstructGuardedActionState = (
  receipt: GuardedActionReceipt,
): { priorState: GuardedActionState; resultState: GuardedActionState } => {
  const { receiptHash, ...receiptWithoutHash } = receipt;
  const expectedReceiptHash = hashValue({
    ...receiptWithoutHash,
    occurredAt: receipt.occurredAt.toISOString(),
  });

  if (receiptHash !== expectedReceiptHash) {
    throw new Error('Guarded action receipt integrity check failed');
  }

  return {
    priorState: receipt.priorState,
    resultState: receipt.resultState,
  };
};
