export type ParyatechCrmObjectName =
  | 'company'
  | 'person'
  | 'opportunity'
  | 'commercialAgreement'
  | 'supportCase'
  | 'sharedException';

export type ParyatechCrmAction =
  | 'CLAIM_AGENCY'
  | 'CLEAR_SUPPRESSION'
  | 'RECORD_OUTREACH_OUTCOME'
  | 'RECORD_SUBSTANTIVE_RESPONSE'
  | 'RECORD_SUPPORT_RECEIPT'
  | 'RELEASE_AGENCY'
  | 'RESUME_SHARED_EXCEPTION'
  | 'TRANSITION_AGREEMENT'
  | 'TRANSITION_OPPORTUNITY'
  | 'TRANSITION_SUPPORT_CASE';

export type ParyatechCrmAvailableAction = {
  action: ParyatechCrmAction;
  requiresReason: boolean;
  requiresEvidence: boolean;
};

export type ParyatechOutreachChannel =
  | 'Email'
  | 'Phone'
  | 'Official WhatsApp'
  | 'Personal WhatsApp Exception'
  | 'Other';

export type ParyatechOutreachOutcome =
  | 'ATTEMPTED'
  | 'PROVIDER_ACCEPTED'
  | 'PENDING_UNKNOWN'
  | 'DELIVERED'
  | 'REACHED_CALL'
  | 'ENGAGED_REPLY'
  | 'TWO_WAY_CONVERSATION'
  | 'FAILED'
  | 'BOUNCED';

export type ParyatechCrmActionInput = {
  reason: string;
  evidence: string;
  agencyId?: string;
  opportunityId?: string;
  agreementId?: string;
  supportCaseId?: string;
  sharedExceptionId?: string;
  amountCollected?: number;
  waivedAmount?: number;
  refundedOrReversedAmount?: number;
  targetObject?: 'company' | 'person';
  targetId?: string;
  expectedStage?: string;
  participatingContactIds?: string[];
  productIds?: string[];
  demoAttendeeIds?: string[];
  targetStage?: string;
  targetTrialState?: string;
  transition?: 'PAYMENT' | 'RENEWAL' | 'ACTIVATION' | 'ADOPTION';
  futureFollowUp?: boolean;
  expectedState?: string;
  targetState?: string;
  evidenceSource?: string;
  evidenceType?: string;
  evidenceVerifierId?: string;
  evidenceObservedAt?: string;
  evidenceState?: 'Current' | 'Stale' | 'Conflict';
  receiptKey?: string;
  providerOrSourceId?: string;
  payloadHash?: string;
  sourceReceivedAt?: string;
  subject?: string;
  summary?: string;
  priority?: 'Urgent' | 'High' | 'Normal' | 'Low';
  ownerId?: string;
  verifiedOpenCaseId?: string;
  verifiedMatchEvidence?: string;
  respondedAt?: string;
  responseSummary?: string;
  expectedStatus?: string;
  targetStatus?: string;
  disposition?: string;
  resolution?: string;
  gatePassed?: boolean;
  contactId?: string;
  channel?: ParyatechOutreachChannel;
  outcome?: ParyatechOutreachOutcome;
  occurredAt?: string;
  providerEvidenceKey?: string;
  nextAction?: string;
  nextActionAt?: string;
};
