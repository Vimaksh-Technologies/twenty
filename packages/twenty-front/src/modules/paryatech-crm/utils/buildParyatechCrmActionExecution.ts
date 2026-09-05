import {
  type ParyatechCrmAction,
  type ParyatechCrmActionExecution,
  type ParyatechCrmObjectName,
  type ParyatechOpportunityStage,
  type ParyatechOutreachChannel,
  type ParyatechOutreachOutcome,
  type ParyatechSupportDisposition,
  type ParyatechSupportStatus,
  type ParyatechTrialState,
} from '@/paryatech-crm/types/ParyatechCrmAction';

const OPPORTUNITY_STAGES: readonly ParyatechOpportunityStage[] = [
  'Qualified',
  'Demo Scheduled',
  'Demo Completed',
  'Proposal / Commercial Decision',
  'Negotiation',
  'Awaiting Payment',
  'Paid / Won',
  'Lost',
];
const TRIAL_STATES: readonly ParyatechTrialState[] = [
  'Approved',
  'Active',
  'Completed',
  'Expired',
  'Cancelled',
];
const AGREEMENT_TRANSITIONS = [
  'PAYMENT',
  'RENEWAL',
  'ACTIVATION',
  'ADOPTION',
] as const;
const EVIDENCE_STATES = ['Current', 'Stale', 'Conflict'] as const;
const SUPPORT_PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'] as const;
const SUPPORT_STATUSES: readonly ParyatechSupportStatus[] = [
  'New',
  'Assigned',
  'In Progress',
  'Waiting on Agency',
  'Waiting Internal',
  'Resolved',
  'Closed',
];
const SUPPORT_DISPOSITIONS: readonly ParyatechSupportDisposition[] = [
  'Support',
  'Duplicate',
  'Non-support',
  'Resolved',
  'Withdrawn',
];

type BuildParyatechCrmActionExecutionParams = {
  action: ParyatechCrmAction;
  agencyId?: string;
  recordId: string;
  objectName: ParyatechCrmObjectName;
  reason: string;
  evidence: string;
  details: Record<string, string>;
  outreach: {
    channel: ParyatechOutreachChannel | '';
    outcome: ParyatechOutreachOutcome | '';
    contactId: string;
    providerEvidenceKey: string;
    nextAction: string;
  };
  now: string;
};

const requireDetail = (
  details: Record<string, string>,
  key: string,
): string => {
  const value = details[key]?.trim();

  if (!value) {
    throw new Error(`${key} is required`);
  }

  return value;
};

const optionalDetail = (
  details: Record<string, string>,
  key: string,
): string | undefined => details[key]?.trim() || undefined;

const optionalNumber = (
  details: Record<string, string>,
  key: string,
): number | undefined => {
  const value = optionalDetail(details, key);

  return value === undefined ? undefined : Number(value);
};

const optionalIds = (
  details: Record<string, string>,
  key: string,
): string[] | undefined => {
  const value = optionalDetail(details, key);

  return value === undefined ? undefined : [value];
};

const requireVocabulary = <TVocabulary extends string>(
  value: string,
  vocabulary: readonly TVocabulary[],
  fieldName: string,
): TVocabulary => {
  const matchingValue = vocabulary.find((candidate) => candidate === value);

  if (matchingValue === undefined) {
    throw new Error(`${fieldName} is invalid`);
  }

  return matchingValue;
};

export const buildParyatechCrmActionExecution = ({
  action,
  agencyId,
  recordId,
  objectName,
  reason,
  evidence,
  details,
  outreach,
  now,
}: BuildParyatechCrmActionExecutionParams): ParyatechCrmActionExecution => {
  const commonInput = { reason, evidence };

  switch (action) {
    case 'CLAIM_AGENCY':
      return {
        action,
        input: { ...commonInput, agencyId: agencyId ?? recordId },
      };
    case 'RELEASE_AGENCY':
      return {
        action,
        input: {
          ...commonInput,
          agencyId: agencyId ?? recordId,
          transferToWorkspaceMemberId: optionalDetail(
            details,
            'transferToWorkspaceMemberId',
          ),
        },
      };
    case 'RECORD_OUTREACH_OUTCOME':
      if (outreach.channel === '' || outreach.outcome === '') {
        throw new Error('Outreach channel and outcome are required');
      }
      return {
        action,
        input: {
          ...commonInput,
          agencyId: agencyId ?? recordId,
          contactId: outreach.contactId.trim() || undefined,
          channel: outreach.channel,
          outcome: outreach.outcome,
          occurredAt: now,
          providerEvidenceKey: outreach.providerEvidenceKey.trim() || undefined,
          nextAction: outreach.nextAction,
          nextActionAt: optionalDetail(details, 'nextActionAt'),
        },
      };
    case 'TRANSITION_OPPORTUNITY':
      return {
        action,
        input: {
          ...commonInput,
          opportunityId: recordId,
          expectedStage: requireVocabulary(
            requireDetail(details, 'expectedStage'),
            OPPORTUNITY_STAGES,
            'expectedStage',
          ),
          targetStage: requireVocabulary(
            requireDetail(details, 'targetStage'),
            OPPORTUNITY_STAGES,
            'targetStage',
          ),
          targetTrialState: optionalDetail(details, 'targetTrialState')
            ? requireVocabulary(
                requireDetail(details, 'targetTrialState'),
                TRIAL_STATES,
                'targetTrialState',
              )
            : undefined,
          participatingContactIds: optionalIds(
            details,
            'participatingContactIds',
          ),
          productIds: optionalIds(details, 'productIds'),
          demoAttendeeIds: optionalIds(details, 'demoAttendeeIds'),
          demoScheduledAt: optionalDetail(details, 'demoScheduledAt'),
          demoOccurredAt: optionalDetail(details, 'demoOccurredAt'),
          demoOutcome: optionalDetail(details, 'demoOutcome'),
          proposalDeliveredAt: optionalDetail(details, 'proposalDeliveredAt'),
          commercialDecisionContext: optionalDetail(
            details,
            'commercialDecisionContext',
          ),
          nextAction: optionalDetail(details, 'nextAction'),
          nextActionAt: optionalDetail(details, 'nextActionAt'),
          agreementId: optionalDetail(details, 'agreementId'),
          acceptedTermsEvidence: optionalDetail(
            details,
            'acceptedTermsEvidence',
          ),
          lossReason: optionalDetail(details, 'lossReason'),
          lossDecisionAt: optionalDetail(details, 'lossDecisionAt'),
          revisitAt: optionalDetail(details, 'revisitAt'),
          futureFollowUp: optionalDetail(details, 'futureFollowUp') === 'Yes',
          trialApprovalEvidence: optionalDetail(
            details,
            'trialApprovalEvidence',
          ),
          trialReason: optionalDetail(details, 'trialReason'),
          trialStartsAt: optionalDetail(details, 'trialStartsAt'),
          trialEndsAt: optionalDetail(details, 'trialEndsAt'),
          trialSuccessCriteria: optionalDetail(details, 'trialSuccessCriteria'),
          trialExpectedDecision: optionalDetail(
            details,
            'trialExpectedDecision',
          ),
          trialExtensionReason: optionalDetail(details, 'trialExtensionReason'),
          trialOutcome: optionalDetail(details, 'trialOutcome'),
        },
      };
    case 'TRANSITION_AGREEMENT':
      return {
        action,
        input: {
          ...commonInput,
          agreementId: recordId,
          transition: requireVocabulary(
            requireDetail(details, 'transition'),
            AGREEMENT_TRANSITIONS,
            'transition',
          ),
          expectedState: requireDetail(details, 'expectedState'),
          targetState: requireDetail(details, 'targetState'),
          evidenceSource: requireDetail(details, 'evidenceSource'),
          evidenceType: requireDetail(details, 'evidenceType'),
          evidenceObservedAt: requireDetail(details, 'evidenceObservedAt'),
          evidenceState: requireVocabulary(
            requireDetail(details, 'evidenceState'),
            EVIDENCE_STATES,
            'evidenceState',
          ),
          amountCollected: optionalNumber(details, 'amountCollected'),
          waivedAmount: optionalNumber(details, 'waivedAmount'),
          refundedOrReversedAmount: optionalNumber(
            details,
            'refundedOrReversedAmount',
          ),
          authorizationEvidence: optionalDetail(
            details,
            'authorizationEvidence',
          ),
          renewalNextAction: optionalDetail(details, 'renewalNextAction'),
          renewalNextActionAt: optionalDetail(details, 'renewalNextActionAt'),
          activationConfirmedAt: optionalDetail(
            details,
            'activationConfirmedAt',
          ),
          adoptionEvidence: optionalDetail(details, 'adoptionEvidence'),
          adoptionObservedAt: optionalDetail(details, 'adoptionObservedAt'),
        },
      };
    case 'RECORD_SUPPORT_RECEIPT':
      return {
        action,
        input: {
          ...commonInput,
          receiptKey: requireDetail(details, 'receiptKey'),
          providerOrSourceId: requireDetail(details, 'providerOrSourceId'),
          payloadHash: requireDetail(details, 'payloadHash'),
          channel: requireDetail(details, 'channel'),
          sourceReceivedAt: requireDetail(details, 'sourceReceivedAt'),
          subject: requireDetail(details, 'subject'),
          summary: requireDetail(details, 'summary'),
          priority: requireVocabulary(
            requireDetail(details, 'priority'),
            SUPPORT_PRIORITIES,
            'priority',
          ),
          verifiedOpenCaseId:
            objectName === 'supportCase'
              ? recordId
              : optionalDetail(details, 'verifiedOpenCaseId'),
          verifiedMatchEvidence: optionalDetail(
            details,
            'verifiedMatchEvidence',
          ),
          agencyId:
            objectName === 'company'
              ? recordId
              : optionalDetail(details, 'agencyId'),
          contactId:
            objectName === 'person'
              ? recordId
              : optionalDetail(details, 'contactId'),
          productId: optionalDetail(details, 'productId'),
          agreementId: optionalDetail(details, 'agreementId'),
        },
      };
    case 'CLEAR_SUPPRESSION':
      if (objectName !== 'company' && objectName !== 'person') {
        throw new Error('Suppression target must be a company or person');
      }
      return {
        action,
        input: { ...commonInput, targetObject: objectName, targetId: recordId },
      };
    case 'RECORD_SUBSTANTIVE_RESPONSE':
      return {
        action,
        input: {
          ...commonInput,
          supportCaseId: recordId,
          respondedAt: now,
          responseSummary: requireDetail(details, 'responseSummary'),
        },
      };
    case 'TRANSITION_SUPPORT_CASE':
      return {
        action,
        input: {
          ...commonInput,
          supportCaseId: recordId,
          expectedStatus: requireVocabulary(
            requireDetail(details, 'expectedStatus'),
            SUPPORT_STATUSES,
            'expectedStatus',
          ),
          targetStatus: requireVocabulary(
            requireDetail(details, 'targetStatus'),
            SUPPORT_STATUSES,
            'targetStatus',
          ),
          disposition: requireVocabulary(
            requireDetail(details, 'disposition'),
            SUPPORT_DISPOSITIONS,
            'disposition',
          ),
          resolution: optionalDetail(details, 'resolution'),
        },
      };
    case 'RESUME_SHARED_EXCEPTION':
      return {
        action,
        input: {
          ...commonInput,
          sharedExceptionId: recordId,
          gatePassed: requireDetail(details, 'gatePassed') === 'Yes',
        },
      };
  }
};
