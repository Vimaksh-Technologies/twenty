import { type ParyatechCrmAction } from 'src/modules/paryatech-crm/types/agency-contact-control.type';

export const GUARDED_ACTION_ACTOR_TYPE = {
  API_KEY: 'API_KEY',
  HUMAN: 'HUMAN',
} as const;

export type GuardedActionActorType =
  (typeof GUARDED_ACTION_ACTOR_TYPE)[keyof typeof GUARDED_ACTION_ACTOR_TYPE];

export type HumanGuardedActionIdentity = {
  userWorkspaceId: string;
  actorWorkspaceMemberId: string;
  apiKeyId?: never;
};

export type ApiKeyGuardedActionIdentity = {
  apiKeyId: string;
  userWorkspaceId?: never;
  actorWorkspaceMemberId?: never;
};

export type GuardedActionIdentity =
  | HumanGuardedActionIdentity
  | ApiKeyGuardedActionIdentity;

export type GuardedActionState =
  | null
  | boolean
  | number
  | string
  | GuardedActionState[]
  | { [key: string]: GuardedActionState };

export type AppendGuardedActionReceiptInput = {
  action: ParyatechCrmAction;
  actor: GuardedActionIdentity;
  reason: string;
  evidenceReference: string;
  occurredAt: Date;
  objectName: string;
  recordId: string;
  ownerId?: string | null;
  priorState: GuardedActionState;
  resultState: GuardedActionState;
  responseSummary?: string;
};

export type GuardedActionReceipt = {
  workspaceId: string;
  actorType: GuardedActionActorType;
  actorId: string;
  action: ParyatechCrmAction;
  reason: string;
  evidenceReference: string;
  evidenceHash: string;
  occurredAt: Date;
  objectName: string;
  recordId: string;
  ownerId: string | null;
  priorState: GuardedActionState;
  resultState: GuardedActionState;
  responseSummary: string | null;
  schemaVersion: 'paryatech-guarded-action-receipt/v1';
  receiptHash: string;
};
