import {
  type AppendGuardedActionReceiptInput,
  type GuardedActionIdentity,
} from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';

export const PARYATECH_CRM_ACTION = {
  CLAIM_AGENCY: 'CLAIM_AGENCY',
  CLEAR_SUPPRESSION: 'CLEAR_SUPPRESSION',
  RECORD_OUTREACH_OUTCOME: 'RECORD_OUTREACH_OUTCOME',
  RECORD_SUBSTANTIVE_RESPONSE: 'RECORD_SUBSTANTIVE_RESPONSE',
  RECORD_SUPPORT_RECEIPT: 'RECORD_SUPPORT_RECEIPT',
  RELEASE_AGENCY: 'RELEASE_AGENCY',
  RESUME_SHARED_EXCEPTION: 'RESUME_SHARED_EXCEPTION',
  TRANSITION_AGREEMENT: 'TRANSITION_AGREEMENT',
  TRANSITION_OPPORTUNITY: 'TRANSITION_OPPORTUNITY',
  TRANSITION_SUPPORT_CASE: 'TRANSITION_SUPPORT_CASE',
} as const;

export type ParyatechCrmAction =
  (typeof PARYATECH_CRM_ACTION)[keyof typeof PARYATECH_CRM_ACTION];

export const OUTREACH_OUTCOME = {
  ATTEMPTED: 'ATTEMPTED',
  BOUNCED: 'BOUNCED',
  DELIVERED: 'DELIVERED',
  ENGAGED_REPLY: 'ENGAGED_REPLY',
  FAILED: 'FAILED',
  PENDING_UNKNOWN: 'PENDING_UNKNOWN',
  PROVIDER_ACCEPTED: 'PROVIDER_ACCEPTED',
  REACHED_CALL: 'REACHED_CALL',
  TWO_WAY_CONVERSATION: 'TWO_WAY_CONVERSATION',
} as const;

export type OutreachOutcome =
  (typeof OUTREACH_OUTCOME)[keyof typeof OUTREACH_OUTCOME];

export type PersistedOutreachOutcome =
  | 'Attempted'
  | 'Provider Accepted / Completed Call'
  | 'Pending / Unknown'
  | 'Contacted'
  | 'Engaged'
  | 'Failed'
  | 'Bounced';

export type AgencyContactControlPermission = {
  canClaim: boolean;
  canRecordOutreach: boolean;
  canRelease: boolean;
  canTransfer: boolean;
};
export type BusinessCalendar = {
  timezone: string;
  workdays: number[];
  holidays: string[];
  startTimeMinutes: number;
  endTimeMinutes: number;
};

export type AgencyContactControlPolicy = {
  businessCalendar: BusinessCalendar;
  pendingUnknownMaxBusinessDays: number;
  reservationIntervalMinutes: number;
};
export type AgencyActionResult = {
  agencyId: string;
  agencyLifecycle: string;
  reservationStatus: string | null;
  reservationClaimantId: string | null;
  reservationExpiresAt: Date | null;
  recordOwnerId: string | null;
  pendingExpiresAt: Date | null;
  firstAttemptedAt: Date | null;
  firstProviderAcceptedAt: Date | null;
  firstPendingUnknownAt: Date | null;
  firstContactedAt: Date | null;
  firstEngagedAt: Date | null;
};

export type RecordOutreachOutcomeParams = GuardedActionIdentity & {
  workspaceId: string;
  agencyId: string;
  contactId?: string;
  channel: string;
  outcome: OutreachOutcome;
  occurredAt: Date;
  providerEvidenceKey?: string;
  evidence: string;
  reason: string;
  nextAction: string;
  nextActionAt?: Date;
  now?: Date;
};

export type AgencyRecord = {
  id: string;
  agencyLifecycle: string;
  recordOwnerId: string | null;
  isSuppressed: boolean;
  reservationStatus: string | null;
  reservationClaimantId: string | null;
  reservationClaimedAt: Date | null;
  reservationExpiresAt: Date | null;
  reservationReleaseReason: string | null;
  firstAttemptedAt: Date | null;
  firstProviderAcceptedAt: Date | null;
  firstPendingUnknownAt: Date | null;
  firstContactedAt: Date | null;
  firstEngagedAt: Date | null;
};

export type ContactRecord = {
  id: string;
  companyId: string | null;
  isSuppressed: boolean;
};

export type OutreachEventRecord = {
  id: string;
  eventReference: string;
  agencyId: string;
  contactId: string | null;
  operatorId: string;
  channel: string;
  initiatedAt: Date;
  outcome: PersistedOutreachOutcome;
  providerEvidenceKey: string | null;
  providerObservedAt: Date | null;
  evidenceSummary: string;
  nextAction: string | null;
  nextActionAt: Date | null;
  pendingExpiresAt: Date | null;
  reasonedRetry: string | null;
  reservationSnapshot: string;
};

export type SharedExceptionRecord = {
  id: string;
  exceptionReference: string;
  capability: string;
  affectedObject: string;
  affectedRecordId: string;
  status: string;
  lastTrustedState: string;
  ownerId: string;
  dueAt: Date | null;
  escalation: string | null;
  evidence: string;
  resolvedAt: Date | null;
  resumeReason: string | null;
  resumedAt: Date | null;
};

export type AgencyContactControlTransaction = {
  agency: AgencyRecord;
  contact: ContactRecord | null;
  existingOutreach: OutreachEventRecord | null;
  unresolvedPendingOutreach: OutreachEventRecord | null;
  unresolvedPendingException: SharedExceptionRecord | null;
  policy: AgencyContactControlPolicy;
  createOutreachEvent: (
    outreachEvent: Omit<OutreachEventRecord, 'id'>,
  ) => Promise<OutreachEventRecord>;
  updateOutreachEvent: (
    id: string,
    patch: Partial<OutreachEventRecord>,
  ) => Promise<OutreachEventRecord>;
  updateAgency: (patch: Partial<AgencyRecord>) => Promise<AgencyRecord>;
  createPendingException: (
    pendingException: Omit<SharedExceptionRecord, 'id'>,
  ) => Promise<void>;
  resolvePendingException: (
    outreachEventId: string,
    evidence: string,
    resolvedAt: Date,
  ) => Promise<void>;
  appendGuardedActionReceipt: (
    receipt: AppendGuardedActionReceiptInput,
  ) => Promise<void>;
};

export type AgencyContactControlTransactionOptions = {
  workspaceId: string;
  agencyId: string;
  contactId?: string;
  providerEvidenceKey?: string;
};

export abstract class AgencyContactControlStore {
  abstract getPermission(
    params: GuardedActionIdentity & {
      workspaceId: string;
    },
  ): Promise<AgencyContactControlPermission>;

  abstract transact<TData>(
    options: AgencyContactControlTransactionOptions,
    operation: (transaction: AgencyContactControlTransaction) => Promise<TData>,
  ): Promise<TData>;

  abstract expireReservations(params: {
    workspaceId: string;
    now: Date;
    batchSize: number;
  }): Promise<number>;
}
