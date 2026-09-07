import { type ParyatechCrmAction } from '@/paryatech-crm/types/ParyatechCrmAction';
import { Select } from '@/ui/input/components/Select';
import { TextArea } from '@/ui/input/components/TextArea';
import { TextInput } from '@/ui/input/components/TextInput';
import { type SelectOption } from 'twenty-ui/input';

type FieldConfiguration = {
  key: string;
  label: string;
  kind: 'select' | 'text' | 'textarea';
  required?: boolean;
  options?: SelectOption<string>[];
};

const options = (values: readonly string[]): SelectOption<string>[] =>
  values.map((value) => ({ label: value, value }));

const OPPORTUNITY_STAGES = options([
  'Qualified',
  'Demo Scheduled',
  'Demo Completed',
  'Proposal / Commercial Decision',
  'Negotiation',
  'Awaiting Payment',
  'Paid / Won',
  'Lost',
]);
const AGREEMENT_STATES = options([
  'Pending',
  'Part-paid',
  'Paid',
  'Overdue',
  'Waived',
  'Refunded',
  'Reversed',
  'Renewing',
  'Renewed',
  'Changed',
  'Not Renewing',
  'Lapsed',
  'Confirmed',
  'Review Required',
  'Not Assessed',
  'Evidence Tracking',
  'Milestone Recorded',
]);
const CASE_STATUSES = options([
  'New',
  'Assigned',
  'In Progress',
  'Waiting on Agency',
  'Waiting Internal',
  'Resolved',
  'Closed',
]);

const U6_FIELD_CONFIGURATIONS: Partial<
  Record<ParyatechCrmAction, FieldConfiguration[]>
> = {
  TRANSITION_OPPORTUNITY: [
    {
      key: 'expectedStage',
      label: 'Expected stage',
      kind: 'select',
      required: true,
      options: OPPORTUNITY_STAGES,
    },
    {
      key: 'targetStage',
      label: 'Target stage',
      kind: 'select',
      required: true,
      options: OPPORTUNITY_STAGES,
    },
    {
      key: 'targetTrialState',
      label: 'Trial state',
      kind: 'select',
      options: options([
        'Approved',
        'Active',
        'Completed',
        'Expired',
        'Cancelled',
      ]),
    },
    { key: 'demoScheduledAt', label: 'Demo scheduled at', kind: 'text' },
    { key: 'demoOccurredAt', label: 'Demo occurred at', kind: 'text' },
    { key: 'demoOutcome', label: 'Demo outcome', kind: 'textarea' },
    {
      key: 'proposalDeliveredAt',
      label: 'Proposal delivered at',
      kind: 'text',
    },
    {
      key: 'commercialDecisionContext',
      label: 'Commercial decision context',
      kind: 'textarea',
    },
    { key: 'nextAction', label: 'Next action', kind: 'textarea' },
    { key: 'nextActionAt', label: 'Next action at', kind: 'text' },
    {
      key: 'acceptedTermsEvidence',
      label: 'Accepted terms evidence',
      kind: 'textarea',
    },
    {
      key: 'lossReason',
      label: 'Loss reason',
      kind: 'select',
      options: options([
        'No Need',
        'No Budget',
        'No Authority',
        'Timing',
        'Competitor',
        'Product Gap',
        'Unresponsive',
        'Duplicate Pursuit',
        'Compliance / Suppression',
        'Other',
      ]),
    },
    { key: 'lossDecisionAt', label: 'Loss decision at', kind: 'text' },
    { key: 'revisitAt', label: 'Revisit at', kind: 'text' },
    {
      key: 'futureFollowUp',
      label: 'Future follow-up',
      kind: 'select',
      options: options(['Yes', 'No']),
    },
    {
      key: 'trialApprovalEvidence',
      label: 'Trial approval evidence',
      kind: 'textarea',
    },
    { key: 'trialReason', label: 'Trial reason', kind: 'textarea' },
    { key: 'trialStartsAt', label: 'Trial starts at', kind: 'text' },
    { key: 'trialEndsAt', label: 'Trial ends at', kind: 'text' },
    {
      key: 'trialSuccessCriteria',
      label: 'Trial success criteria',
      kind: 'textarea',
    },
    {
      key: 'trialExpectedDecision',
      label: 'Trial expected decision',
      kind: 'textarea',
    },
    {
      key: 'trialExtensionReason',
      label: 'Trial extension reason',
      kind: 'textarea',
    },
    { key: 'trialOutcome', label: 'Trial outcome', kind: 'textarea' },
  ],
  TRANSITION_AGREEMENT: [
    {
      key: 'transition',
      label: 'Transition',
      kind: 'select',
      required: true,
      options: options(['PAYMENT', 'RENEWAL', 'ACTIVATION', 'ADOPTION']),
    },
    {
      key: 'expectedState',
      label: 'Expected state',
      kind: 'select',
      required: true,
      options: AGREEMENT_STATES,
    },
    {
      key: 'targetState',
      label: 'Target state',
      kind: 'select',
      required: true,
      options: AGREEMENT_STATES,
    },
    {
      key: 'evidenceSource',
      label: 'Evidence source',
      kind: 'text',
      required: true,
    },
    {
      key: 'evidenceType',
      label: 'Evidence type',
      kind: 'text',
      required: true,
    },
    {
      key: 'evidenceObservedAt',
      label: 'Evidence observed at',
      kind: 'text',
      required: true,
    },
    {
      key: 'evidenceState',
      label: 'Evidence state',
      kind: 'select',
      required: true,
      options: options(['Current', 'Stale', 'Conflict']),
    },
    { key: 'amountCollected', label: 'Amount collected', kind: 'text' },
    { key: 'waivedAmount', label: 'Waived amount', kind: 'text' },
    {
      key: 'refundedOrReversedAmount',
      label: 'Refunded or reversed amount',
      kind: 'text',
    },
    {
      key: 'authorizationEvidence',
      label: 'Authorization evidence',
      kind: 'textarea',
    },
    {
      key: 'renewalNextAction',
      label: 'Renewal next action',
      kind: 'textarea',
    },
    {
      key: 'renewalNextActionAt',
      label: 'Renewal next action at',
      kind: 'text',
    },
    {
      key: 'activationConfirmedAt',
      label: 'Activation confirmed at',
      kind: 'text',
    },
    { key: 'adoptionEvidence', label: 'Adoption evidence', kind: 'textarea' },
    { key: 'adoptionObservedAt', label: 'Adoption observed at', kind: 'text' },
  ],
  RECORD_SUPPORT_RECEIPT: [
    { key: 'receiptKey', label: 'Receipt key', kind: 'text', required: true },
    {
      key: 'providerOrSourceId',
      label: 'Provider or source ID',
      kind: 'text',
      required: true,
    },
    { key: 'payloadHash', label: 'Payload hash', kind: 'text', required: true },
    {
      key: 'channel',
      label: 'Support channel',
      kind: 'select',
      required: true,
      options: options([
        'Email',
        'Phone',
        'Official WhatsApp',
        'Personal WhatsApp',
        'Manual Report',
        'Other',
      ]),
    },
    {
      key: 'sourceReceivedAt',
      label: 'Source received at',
      kind: 'text',
      required: true,
    },
    { key: 'subject', label: 'Subject', kind: 'text', required: true },
    { key: 'summary', label: 'Summary', kind: 'textarea', required: true },
    {
      key: 'priority',
      label: 'Priority',
      kind: 'select',
      required: true,
      options: options(['Urgent', 'High', 'Normal', 'Low']),
    },
    {
      key: 'verifiedMatchEvidence',
      label: 'Verified Case match evidence',
      kind: 'textarea',
    },
  ],
  RECORD_SUBSTANTIVE_RESPONSE: [
    {
      key: 'responseSummary',
      label: 'Response summary',
      kind: 'textarea',
      required: true,
    },
  ],
  TRANSITION_SUPPORT_CASE: [
    {
      key: 'expectedStatus',
      label: 'Expected status',
      kind: 'select',
      required: true,
      options: CASE_STATUSES,
    },
    {
      key: 'targetStatus',
      label: 'Target status',
      kind: 'select',
      required: true,
      options: CASE_STATUSES,
    },
    {
      key: 'disposition',
      label: 'Disposition',
      kind: 'select',
      required: true,
      options: options([
        'Support',
        'Duplicate',
        'Non-support',
        'Resolved',
        'Withdrawn',
      ]),
    },
    { key: 'resolution', label: 'Resolution', kind: 'textarea' },
  ],
  RESUME_SHARED_EXCEPTION: [
    {
      key: 'gatePassed',
      label: 'Gate passed',
      kind: 'select',
      required: true,
      options: options(['Yes', 'No']),
    },
  ],
};

type ParyatechCrmActionDetailsProps = {
  action: ParyatechCrmAction;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  disabled: boolean;
};

export const ParyatechCrmActionDetails = ({
  action,
  values,
  onChange,
  disabled,
}: ParyatechCrmActionDetailsProps) => (
  <>
    {(U6_FIELD_CONFIGURATIONS[action] ?? []).map((field) => {
      if (field.kind === 'select') {
        return (
          <Select
            key={field.key}
            dropdownId={`paryatech-${field.key}`}
            label={field.label}
            fullWidth
            value={values[field.key] ?? ''}
            options={field.options ?? []}
            emptyOption={{
              label: `Select ${field.label.toLowerCase()}`,
              value: '',
            }}
            onChange={(value) => onChange(field.key, value)}
            disabled={disabled}
          />
        );
      }
      if (field.kind === 'textarea') {
        return (
          <TextArea
            key={field.key}
            textAreaId={`paryatech-${field.key}`}
            label={field.label}
            value={values[field.key] ?? ''}
            onChange={(value) => onChange(field.key, value)}
            disabled={disabled}
          />
        );
      }
      return (
        <TextInput
          key={field.key}
          label={field.label}
          value={values[field.key] ?? ''}
          onChange={(value) => onChange(field.key, value)}
          disabled={disabled}
          fullWidth
        />
      );
    })}
  </>
);

export const areParyatechActionDetailsValid = (
  action: ParyatechCrmAction,
  values: Record<string, string>,
) =>
  (U6_FIELD_CONFIGURATIONS[action] ?? [])
    .filter(({ required }) => required)
    .every(({ key }) => (values[key] ?? '').trim().length > 0);
