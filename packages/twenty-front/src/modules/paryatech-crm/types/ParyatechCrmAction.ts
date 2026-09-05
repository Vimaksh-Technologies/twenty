export type ParyatechCrmAction =
  | 'CLAIM_AGENCY'
  | 'RELEASE_AGENCY'
  | 'RECORD_OUTREACH_OUTCOME';

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
  agencyId: string;
  reason: string;
  evidence: string;
  contactId?: string;
  channel?: ParyatechOutreachChannel;
  outcome?: ParyatechOutreachOutcome;
  occurredAt?: string;
  providerEvidenceKey?: string;
  nextAction?: string;
  nextActionAt?: string;
};
