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

export type ParyatechOpportunityStage =
  | 'Qualified'
  | 'Demo Scheduled'
  | 'Demo Completed'
  | 'Proposal / Commercial Decision'
  | 'Negotiation'
  | 'Awaiting Payment'
  | 'Paid / Won'
  | 'Lost';

export type ParyatechTrialState =
  | 'Approved'
  | 'Active'
  | 'Completed'
  | 'Expired'
  | 'Cancelled';

export type ParyatechSupportStatus =
  | 'New'
  | 'Assigned'
  | 'In Progress'
  | 'Waiting on Agency'
  | 'Waiting Internal'
  | 'Resolved'
  | 'Closed';

export type ParyatechSupportDisposition =
  | 'Support'
  | 'Duplicate'
  | 'Non-support'
  | 'Resolved'
  | 'Withdrawn';

export type ParyatechReasonEvidenceInput = {
  reason: string;
  evidence: string;
};

export type ClaimAgencyInput = ParyatechReasonEvidenceInput & {
  agencyId: string;
};

export type ReleaseAgencyInput = ParyatechReasonEvidenceInput & {
  agencyId: string;
  transferToWorkspaceMemberId?: string;
};

export type RecordOutreachOutcomeInput = ParyatechReasonEvidenceInput & {
  agencyId: string;
  contactId?: string;
  channel: ParyatechOutreachChannel;
  outcome: ParyatechOutreachOutcome;
  occurredAt: string;
  providerEvidenceKey?: string;
  nextAction: string;
  nextActionAt?: string;
};

export type TransitionOpportunityInput = ParyatechReasonEvidenceInput & {
  opportunityId: string;
  expectedStage: ParyatechOpportunityStage;
  targetStage: ParyatechOpportunityStage;
  targetTrialState?: ParyatechTrialState;
  participatingContactIds?: string[];
  productIds?: string[];
  demoAttendeeIds?: string[];
  demoScheduledAt?: string;
  demoOccurredAt?: string;
  demoOutcome?: string;
  proposalDeliveredAt?: string;
  commercialDecisionContext?: string;
  nextAction?: string;
  nextActionAt?: string;
  agreementId?: string;
  acceptedTermsEvidence?: string;
  lossReason?: string;
  lossDecisionAt?: string;
  revisitAt?: string;
  futureFollowUp?: boolean;
  trialApprovalEvidence?: string;
  trialReason?: string;
  trialStartsAt?: string;
  trialEndsAt?: string;
  trialSuccessCriteria?: string;
  trialExpectedDecision?: string;
  trialExtensionReason?: string;
  trialOutcome?: string;
};

export type TransitionAgreementInput = ParyatechReasonEvidenceInput & {
  agreementId: string;
  transition: 'PAYMENT' | 'RENEWAL' | 'ACTIVATION' | 'ADOPTION';
  expectedState: string;
  targetState: string;
  evidenceSource: string;
  evidenceType: string;
  evidenceObservedAt: string;
  evidenceState: 'Current' | 'Stale' | 'Conflict';
  amountCollected?: number;
  waivedAmount?: number;
  refundedOrReversedAmount?: number;
  authorizationEvidence?: string;
  renewalNextAction?: string;
  renewalNextActionAt?: string;
  activationConfirmedAt?: string;
  adoptionEvidence?: string;
  adoptionObservedAt?: string;
};

export type RecordSupportReceiptInput = ParyatechReasonEvidenceInput & {
  receiptKey: string;
  providerOrSourceId: string;
  payloadHash: string;
  channel: string;
  sourceReceivedAt: string;
  subject: string;
  summary: string;
  priority: 'Urgent' | 'High' | 'Normal' | 'Low';
  verifiedOpenCaseId?: string;
  verifiedMatchEvidence?: string;
  agencyId?: string;
  contactId?: string;
  productId?: string;
  agreementId?: string;
};

export type ClearSuppressionInput = ParyatechReasonEvidenceInput & {
  targetObject: 'company' | 'person';
  targetId: string;
};

export type RecordSubstantiveResponseInput = ParyatechReasonEvidenceInput & {
  supportCaseId: string;
  respondedAt: string;
  responseSummary: string;
};

export type TransitionSupportCaseInput = ParyatechReasonEvidenceInput & {
  supportCaseId: string;
  expectedStatus: ParyatechSupportStatus;
  targetStatus: ParyatechSupportStatus;
  disposition: ParyatechSupportDisposition;
  resolution?: string;
};

export type ResumeSharedExceptionInput = ParyatechReasonEvidenceInput & {
  sharedExceptionId: string;
  gatePassed: boolean;
};

export type ParyatechCrmActionInputByAction = {
  CLAIM_AGENCY: ClaimAgencyInput;
  RELEASE_AGENCY: ReleaseAgencyInput;
  RECORD_OUTREACH_OUTCOME: RecordOutreachOutcomeInput;
  TRANSITION_OPPORTUNITY: TransitionOpportunityInput;
  TRANSITION_AGREEMENT: TransitionAgreementInput;
  RECORD_SUPPORT_RECEIPT: RecordSupportReceiptInput;
  CLEAR_SUPPRESSION: ClearSuppressionInput;
  RECORD_SUBSTANTIVE_RESPONSE: RecordSubstantiveResponseInput;
  TRANSITION_SUPPORT_CASE: TransitionSupportCaseInput;
  RESUME_SHARED_EXCEPTION: ResumeSharedExceptionInput;
};

export type ParyatechCrmActionExecution = {
  [TAction in ParyatechCrmAction]: {
    action: TAction;
    input: ParyatechCrmActionInputByAction[TAction];
  };
}[ParyatechCrmAction];

export type ParyatechAgencyActionResult = {
  agencyId: string;
  agencyLifecycle: string;
  reservationStatus: string | null;
  reservationClaimantId: string | null;
  reservationExpiresAt: string | null;
  recordOwnerId: string | null;
  pendingExpiresAt: string | null;
  firstAttemptedAt: string | null;
  firstProviderAcceptedAt: string | null;
  firstPendingUnknownAt: string | null;
  firstContactedAt: string | null;
  firstEngagedAt: string | null;
};

export type ParyatechTransitionResult = {
  recordId: string;
  objectName: string;
  state: string;
  correction: string | null;
};

export type ParyatechCrmMutationDataByAction = {
  CLAIM_AGENCY: { claimAgency: ParyatechAgencyActionResult };
  RELEASE_AGENCY: { releaseAgency: ParyatechAgencyActionResult };
  RECORD_OUTREACH_OUTCOME: {
    recordOutreachOutcome: ParyatechAgencyActionResult;
  };
  TRANSITION_OPPORTUNITY: {
    transitionOpportunity: ParyatechTransitionResult;
  };
  TRANSITION_AGREEMENT: { transitionAgreement: ParyatechTransitionResult };
  RECORD_SUPPORT_RECEIPT: {
    recordSupportReceipt: ParyatechTransitionResult & { replayed: boolean };
  };
  CLEAR_SUPPRESSION: { clearSuppression: ParyatechTransitionResult };
  RECORD_SUBSTANTIVE_RESPONSE: {
    recordSubstantiveResponse: ParyatechTransitionResult;
  };
  TRANSITION_SUPPORT_CASE: {
    transitionSupportCase: ParyatechTransitionResult;
  };
  RESUME_SHARED_EXCEPTION: {
    resumeSharedException: ParyatechTransitionResult;
  };
};

export type ParyatechCrmMutationData<TAction extends ParyatechCrmAction> =
  ParyatechCrmMutationDataByAction[TAction];

export type ParyatechCrmMutationVariables<TAction extends ParyatechCrmAction> =
  {
    input: ParyatechCrmActionInputByAction[TAction];
  };
