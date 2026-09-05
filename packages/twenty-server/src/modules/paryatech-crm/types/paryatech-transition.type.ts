import {
  type AppendGuardedActionReceiptInput,
  type GuardedActionIdentity,
  type HumanGuardedActionIdentity,
} from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';

export const PARYATECH_ROLE = {
  OPERATOR: 'Paryatech Operator',
  COMMERCIAL_SENSITIVE: 'Paryatech Commercial Sensitive',
  COMMERCIAL_CUTOVER: 'Paryatech Commercial Cutover',
  LEGAL_COMPLIANCE: 'Paryatech Legal Compliance',
  AUDIT_REVIEWER: 'Paryatech Audit Reviewer',
  RECOVERY_ADMINISTRATOR: 'Paryatech Recovery Administrator',
  COMMUNICATION_INTAKE: 'Paryatech Communication Intake',
  SUPPORT_INTAKE: 'Paryatech Support Intake',
} as const;

export type ParyatechRole =
  (typeof PARYATECH_ROLE)[keyof typeof PARYATECH_ROLE];

export const OPPORTUNITY_STAGES = [
  'Qualified',
  'Demo Scheduled',
  'Demo Completed',
  'Proposal / Commercial Decision',
  'Negotiation',
  'Awaiting Payment',
  'Paid / Won',
  'Lost',
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export type TrialState =
  | 'Approved'
  | 'Active'
  | 'Completed'
  | 'Expired'
  | 'Cancelled';
export type PaymentState =
  | 'Pending'
  | 'Part-paid'
  | 'Paid'
  | 'Overdue'
  | 'Waived'
  | 'Refunded'
  | 'Reversed';
export type RenewalState =
  | 'Renewing'
  | 'Renewed'
  | 'Changed'
  | 'Not Renewing'
  | 'Lapsed';
export type ActivationState = 'Pending' | 'Confirmed' | 'Review Required';
export type AdoptionState =
  | 'Not Assessed'
  | 'Evidence Tracking'
  | 'Milestone Recorded';
export type SupportStatus =
  | 'New'
  | 'Assigned'
  | 'In Progress'
  | 'Waiting on Agency'
  | 'Waiting Internal'
  | 'Resolved'
  | 'Closed';
export type SupportDisposition =
  | 'Support'
  | 'Duplicate'
  | 'Non-support'
  | 'Resolved'
  | 'Withdrawn';
export type SupportPriority = 'Urgent' | 'High' | 'Normal' | 'Low';

export type GuardedActionContext = HumanGuardedActionIdentity & {
  workspaceId: string;
  reason: string;
  evidence: string;
  now?: Date;
};

export type TransitionOpportunityParams = GuardedActionContext & {
  opportunityId: string;
  expectedStage: OpportunityStage;
  targetStage: OpportunityStage;
  targetTrialState?: TrialState;
  participatingContactIds?: string[];
  productIds?: string[];
  demoAttendeeIds?: string[];
  demoScheduledAt?: Date;
  demoOccurredAt?: Date;
  demoOutcome?: string;
  proposalDeliveredAt?: Date;
  commercialDecisionContext?: string;
  nextAction?: string;
  nextActionAt?: Date;
  agreementId?: string;
  acceptedTermsEvidence?: string;
  lossReason?: string;
  lossDecisionAt?: Date;
  revisitAt?: Date;
  futureFollowUp?: boolean;
  trialApprovalEvidence?: string;
  trialReason?: string;
  trialOwnerId?: string;
  trialStartsAt?: Date;
  trialEndsAt?: Date;
  trialSuccessCriteria?: string;
  trialExpectedDecision?: string;
  trialExtensionReason?: string;
  trialOutcome?: string;
};

export type TransitionAgreementParams = GuardedActionContext & {
  agreementId: string;
  transition: 'PAYMENT' | 'RENEWAL' | 'ACTIVATION' | 'ADOPTION';
  expectedState: string;
  targetState: string;
  evidenceSource: string;
  evidenceType: string;
  evidenceVerifierId: string;
  evidenceObservedAt: Date;
  evidenceState: 'Current' | 'Stale' | 'Conflict';
  amountCollected?: number;
  waivedAmount?: number;
  refundedOrReversedAmount?: number;
  authorizationEvidence?: string;
  renewalNextAction?: string;
  renewalNextActionAt?: Date;
  activationConfirmedAt?: Date;
  activationConfirmerId?: string;
  adoptionEvidence?: string;
  adoptionObservedAt?: Date;
};

export type RecordSupportReceiptParams = GuardedActionIdentity & {
  workspaceId: string;
  reason: string;
  evidence: string;
  now?: Date;
  receiptKey: string;
  providerOrSourceId: string;
  payloadHash: string;
  channel: string;
  sourceReceivedAt: Date;
  subject: string;
  summary: string;
  priority: SupportPriority;
  verifiedOpenCaseId?: string;
  verifiedMatchEvidence?: string;
  agencyId?: string;
  contactId?: string;
  productId?: string;
  agreementId?: string;
};

export type RecordSubstantiveResponseParams = GuardedActionContext & {
  supportCaseId: string;
  respondedAt: Date;
  responseSummary: string;
};

export type TransitionSupportCaseParams = GuardedActionContext & {
  supportCaseId: string;
  expectedStatus: SupportStatus;
  targetStatus: SupportStatus;
  disposition: SupportDisposition;
  resolution?: string;
};

export type ClearSuppressionParams = GuardedActionContext & {
  targetObject: 'company' | 'person';
  targetId: string;
};

export type ResumeSharedExceptionParams = GuardedActionContext & {
  sharedExceptionId: string;
  gatePassed: boolean;
};

export type GuardedTransitionResult = {
  recordId: string;
  objectName: string;
  state: string;
  correction: string | null;
  replayed?: boolean;
};

export type ParyatechRecord = Record<string, unknown> & { id: string };

export type ParyatechTransitionTransaction = {
  record: ParyatechRecord | null;
  findOne: (
    objectName: string,
    where: Record<string, unknown>,
  ) => Promise<ParyatechRecord | null>;
  findMany: (
    objectName: string,
    where: Record<string, unknown>,
  ) => Promise<ParyatechRecord[]>;
  getRequired: (objectName: string, id: string) => Promise<ParyatechRecord>;
  create: (
    objectName: string,
    data: Record<string, unknown>,
  ) => Promise<ParyatechRecord>;
  update: (
    objectName: string,
    id: string,
    patch: Record<string, unknown>,
  ) => Promise<ParyatechRecord>;
  appendGuardedActionReceipt: (
    receipt: AppendGuardedActionReceiptInput,
  ) => Promise<void>;
};

export type ParyatechTransitionTransactionOptions = {
  workspaceId: string;
  objectName: string;
  recordId?: string;
  lockKey?: string;
};

export abstract class ParyatechTransitionStore {
  abstract getActorRoleLabel(
    params: GuardedActionIdentity & {
      workspaceId: string;
    },
  ): Promise<string>;

  abstract transact<TData>(
    options: ParyatechTransitionTransactionOptions,
    operation: (transaction: ParyatechTransitionTransaction) => Promise<TData>,
  ): Promise<TData>;
}
