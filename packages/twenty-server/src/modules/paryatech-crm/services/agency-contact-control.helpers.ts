import { randomUUID } from 'node:crypto';

import {
  OUTREACH_OUTCOME,
  type OutreachOutcome,
  type PersistedOutreachOutcome,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

export const OUTREACH_CHANNELS = [
  'Email',
  'Phone',
  'Official WhatsApp',
  'Personal WhatsApp Exception',
  'Other',
] as const;

export const UNRESOLVED_EXCEPTION_STATUSES = [
  'New',
  'Investigating',
  'Blocked',
  'Reopened',
] as const;

export const toPersistedOutreachOutcome = (
  outcome: OutreachOutcome,
): PersistedOutreachOutcome => {
  switch (outcome) {
    case OUTREACH_OUTCOME.ATTEMPTED:
      return 'Attempted';
    case OUTREACH_OUTCOME.PROVIDER_ACCEPTED:
      return 'Provider Accepted / Completed Call';
    case OUTREACH_OUTCOME.PENDING_UNKNOWN:
      return 'Pending / Unknown';
    case OUTREACH_OUTCOME.DELIVERED:
    case OUTREACH_OUTCOME.REACHED_CALL:
      return 'Contacted';
    case OUTREACH_OUTCOME.ENGAGED_REPLY:
    case OUTREACH_OUTCOME.TWO_WAY_CONVERSATION:
      return 'Engaged';
    case OUTREACH_OUTCOME.FAILED:
      return 'Failed';
    case OUTREACH_OUTCOME.BOUNCED:
      return 'Bounced';
  }
};

export const isQualifyingContactOutcome = (outcome: OutreachOutcome) =>
  outcome === OUTREACH_OUTCOME.DELIVERED ||
  outcome === OUTREACH_OUTCOME.REACHED_CALL ||
  outcome === OUTREACH_OUTCOME.ENGAGED_REPLY ||
  outcome === OUTREACH_OUTCOME.TWO_WAY_CONVERSATION;

export const isEngagedOutcome = (outcome: OutreachOutcome) =>
  outcome === OUTREACH_OUTCOME.ENGAGED_REPLY ||
  outcome === OUTREACH_OUTCOME.TWO_WAY_CONVERSATION;

export const isFailureOutcome = (outcome: OutreachOutcome) =>
  outcome === OUTREACH_OUTCOME.BOUNCED || outcome === OUTREACH_OUTCOME.FAILED;

export const requiresContactReference = (outcome: OutreachOutcome) =>
  outcome === OUTREACH_OUTCOME.REACHED_CALL ||
  outcome === OUTREACH_OUTCOME.ENGAGED_REPLY ||
  outcome === OUTREACH_OUTCOME.TWO_WAY_CONVERSATION;

export const requiresProviderEvidenceKey = (outcome: OutreachOutcome) =>
  outcome === OUTREACH_OUTCOME.PROVIDER_ACCEPTED ||
  outcome === OUTREACH_OUTCOME.PENDING_UNKNOWN ||
  outcome === OUTREACH_OUTCOME.DELIVERED ||
  outcome === OUTREACH_OUTCOME.BOUNCED;

export const buildEvidenceSummary = ({
  outcome,
  evidence,
  reason,
}: {
  outcome: OutreachOutcome;
  evidence: string;
  reason: string;
}) =>
  [
    `Observed outcome: ${outcome}`,
    `Evidence: ${evidence.trim()}`,
    `Reason: ${reason.trim()}`,
  ].join('\n');

export const buildEventReference = (providerEvidenceKey?: string) =>
  providerEvidenceKey === undefined
    ? `outreach-${randomUUID()}`
    : `outreach-${providerEvidenceKey}`;

export const buildExceptionReference = (eventReference: string) =>
  `outreach-pending-${eventReference}`;
