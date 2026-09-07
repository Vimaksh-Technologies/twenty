import {
  areParyatechActionDetailsValid,
  ParyatechCrmActionDetails,
} from '@/paryatech-crm/components/ParyatechCrmActionDetails';
import { ParyatechCrmActionResult } from '@/paryatech-crm/components/ParyatechCrmActionResult';
import { useAgencyContactOptions } from '@/paryatech-crm/hooks/useAgencyContactOptions';
import { useExecuteParyatechCrmAction } from '@/paryatech-crm/hooks/useExecuteParyatechCrmAction';
import { useParyatechOpportunityRelationOptions } from '@/paryatech-crm/hooks/useParyatechOpportunityRelationOptions';
import { buildParyatechCrmActionExecution } from '@/paryatech-crm/utils/buildParyatechCrmActionExecution';
import {
  type ParyatechCrmAction,
  type ParyatechOutreachChannel,
  type ParyatechOutreachOutcome,
  type ParyatechCrmObjectName,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { Select } from '@/ui/input/components/Select';
import { TextArea } from '@/ui/input/components/TextArea';
import { TextInput } from '@/ui/input/components/TextInput';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { Button, type SelectOption } from 'twenty-ui/input';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[3]};
`;

const OUTCOME_OPTIONS: SelectOption<ParyatechOutreachOutcome>[] = [
  { label: 'Attempted', value: 'ATTEMPTED' },
  {
    label: 'Provider Accepted / Completed Call — no person reached',
    value: 'PROVIDER_ACCEPTED',
  },
  { label: 'Pending / Unknown', value: 'PENDING_UNKNOWN' },
  { label: 'Contacted — Delivered', value: 'DELIVERED' },
  { label: 'Contacted — Reached Call', value: 'REACHED_CALL' },
  { label: 'Engaged — Reply', value: 'ENGAGED_REPLY' },
  {
    label: 'Engaged — Two-way Conversation',
    value: 'TWO_WAY_CONVERSATION',
  },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Bounced', value: 'BOUNCED' },
];

const CHANNEL_OPTIONS: SelectOption<ParyatechOutreachChannel>[] = [
  { label: 'Email', value: 'Email' },
  { label: 'Phone', value: 'Phone' },
  { label: 'Official WhatsApp', value: 'Official WhatsApp' },
  {
    label: 'Personal WhatsApp Exception',
    value: 'Personal WhatsApp Exception',
  },
  { label: 'Other', value: 'Other' },
];

const CONTACT_REQUIRED_OUTCOMES: ParyatechOutreachOutcome[] = [
  'REACHED_CALL',
  'ENGAGED_REPLY',
  'TWO_WAY_CONVERSATION',
];

const PROVIDER_KEY_REQUIRED_OUTCOMES: ParyatechOutreachOutcome[] = [
  'PROVIDER_ACCEPTED',
  'PENDING_UNKNOWN',
  'DELIVERED',
  'BOUNCED',
];

type ParyatechCrmActionFormProps = {
  action: ParyatechCrmAction;
  agencyId?: string;
  recordId?: string;
  objectName?: ParyatechCrmObjectName;
  onSuccess: () => void | Promise<void>;
};

export const ParyatechCrmActionForm = ({
  action,
  agencyId,
  recordId = agencyId ?? '',
  objectName = 'company',
  onSuccess,
}: ParyatechCrmActionFormProps) => {
  const { execute, loading } = useExecuteParyatechCrmAction();
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [contactId, setContactId] = useState('');
  const [providerEvidenceKey, setProviderEvidenceKey] = useState('');
  const [channel, setChannel] = useState<ParyatechOutreachChannel | ''>('');
  const [outcome, setOutcome] = useState<ParyatechOutreachOutcome | ''>('');
  const [nextAction, setNextAction] = useState('');
  const [details, setDetails] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOutreach = action === 'RECORD_OUTREACH_OUTCOME';
  const { options: contactOptions, loading: contactsLoading } =
    useAgencyContactOptions(isOutreach ? (agencyId ?? '') : '');
  const opportunityRelationOptions = useParyatechOpportunityRelationOptions(
    action === 'TRANSITION_OPPORTUNITY',
  );
  const contactRequired =
    outcome !== '' && CONTACT_REQUIRED_OUTCOMES.includes(outcome);
  const providerEvidenceKeyRequired =
    outcome !== '' && PROVIDER_KEY_REQUIRED_OUTCOMES.includes(outcome);
  const hasRequiredOutreachFields =
    !isOutreach ||
    (channel !== '' &&
      outcome !== '' &&
      (!contactRequired || contactId.trim().length > 0) &&
      (!providerEvidenceKeyRequired || providerEvidenceKey.trim().length > 0));
  const hasRequiredCaseMatchEvidence =
    action !== 'RECORD_SUPPORT_RECEIPT' ||
    objectName !== 'supportCase' ||
    (details.verifiedMatchEvidence ?? '').trim().length > 0;
  const isValid =
    reason.trim().length > 0 &&
    evidence.trim().length > 0 &&
    hasRequiredOutreachFields &&
    hasRequiredCaseMatchEvidence &&
    areParyatechActionDetailsValid(action, details);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!isValid || loading || isSubmitting) {
      return;
    }

    const focusedElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const mutationResult = await execute(
        buildParyatechCrmActionExecution({
          action,
          agencyId,
          recordId,
          objectName,
          reason,
          evidence,
          details,
          outreach: {
            channel,
            outcome,
            contactId,
            providerEvidenceKey,
            nextAction,
          },
          now: new Date().toISOString(),
        }),
      );
      const actionResult = Object.values(mutationResult?.data ?? {})[0];
      const correction =
        actionResult !== null &&
        typeof actionResult === 'object' &&
        'correction' in actionResult &&
        typeof actionResult.correction === 'string'
          ? actionResult.correction
          : null;
      setSuccessMessage(correction ?? 'CRM record updated.');
      await onSuccess();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'The action failed. Review the evidence before retrying.',
      );
      focusedElement?.focus();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <StyledForm onSubmit={handleSubmit} aria-label="CRM record action">
      {isOutreach && (
        <>
          <Select
            dropdownId="paryatech-outreach-channel"
            label="Channel"
            fullWidth
            value={channel}
            options={CHANNEL_OPTIONS}
            emptyOption={{ label: 'Select a channel', value: '' }}
            onChange={(value) => setChannel(value as ParyatechOutreachChannel)}
          />
          <Select
            dropdownId="paryatech-outreach-outcome"
            label="Outcome"
            fullWidth
            value={outcome}
            options={OUTCOME_OPTIONS}
            emptyOption={{ label: 'Select an outcome', value: '' }}
            onChange={(value) => setOutcome(value as ParyatechOutreachOutcome)}
          />
          <Select
            dropdownId="paryatech-outreach-contact"
            label={`Contact${contactRequired ? ' (required)' : ' (optional)'}`}
            fullWidth
            value={contactId}
            options={contactOptions}
            emptyOption={{
              label: 'No Contact — Agency-level evidence',
              value: '',
            }}
            onChange={setContactId}
            disabled={loading || isSubmitting || contactsLoading}
          />
          <TextInput
            label={`Provider evidence key${providerEvidenceKeyRequired ? ' (required)' : ' (optional)'}`}
            value={providerEvidenceKey}
            onChange={setProviderEvidenceKey}
            disabled={loading || isSubmitting}
            fullWidth
          />
          <TextArea
            textAreaId="paryatech-next-action"
            label="Next action (optional)"
            value={nextAction}
            onChange={setNextAction}
            disabled={loading || isSubmitting}
          />
        </>
      )}
      <ParyatechCrmActionDetails
        action={action}
        values={details}
        onChange={(key, value) =>
          setDetails((currentDetails) => ({
            ...currentDetails,
            [key]: value,
          }))
        }
        disabled={loading || isSubmitting}
      />
      {action === 'TRANSITION_OPPORTUNITY' && (
        <>
          <Select
            dropdownId="paryatech-participating-contact"
            label="Participating Contact"
            fullWidth
            value={details.participatingContactIds ?? ''}
            options={opportunityRelationOptions.contactOptions}
            emptyOption={{ label: 'Select a participating Contact', value: '' }}
            onChange={(value) =>
              setDetails((currentDetails) => ({
                ...currentDetails,
                participatingContactIds: value,
              }))
            }
            disabled={loading || isSubmitting}
          />
          <Select
            dropdownId="paryatech-product"
            label="Product"
            fullWidth
            value={details.productIds ?? ''}
            options={opportunityRelationOptions.productOptions}
            emptyOption={{ label: 'Select a Product', value: '' }}
            onChange={(value) =>
              setDetails((currentDetails) => ({
                ...currentDetails,
                productIds: value,
              }))
            }
            disabled={loading || isSubmitting}
          />
          <Select
            dropdownId="paryatech-demo-attendee"
            label="Demo attendee"
            fullWidth
            value={details.demoAttendeeIds ?? ''}
            options={opportunityRelationOptions.contactOptions}
            emptyOption={{ label: 'Select a demo attendee', value: '' }}
            onChange={(value) =>
              setDetails((currentDetails) => ({
                ...currentDetails,
                demoAttendeeIds: value,
              }))
            }
            disabled={loading || isSubmitting}
          />
          <Select
            dropdownId="paryatech-agreement"
            label="Commercial Agreement"
            fullWidth
            value={details.agreementId ?? ''}
            options={opportunityRelationOptions.agreementOptions}
            emptyOption={{ label: 'Select a Commercial Agreement', value: '' }}
            onChange={(value) =>
              setDetails((currentDetails) => ({
                ...currentDetails,
                agreementId: value,
              }))
            }
            disabled={loading || isSubmitting}
          />
        </>
      )}
      <TextArea
        textAreaId="paryatech-action-reason"
        label="Reason"
        value={reason}
        onChange={setReason}
        disabled={loading || isSubmitting}
      />
      <TextArea
        textAreaId="paryatech-action-evidence"
        label="Evidence"
        value={evidence}
        onChange={setEvidence}
        disabled={loading || isSubmitting}
      />
      {error && <ParyatechCrmActionResult message={error} error />}
      {successMessage && <ParyatechCrmActionResult message={successMessage} />}
      <Button
        type="submit"
        title={loading || isSubmitting ? 'Saving…' : 'Confirm action'}
        disabled={
          !isValid || loading || isSubmitting || (isOutreach && contactsLoading)
        }
        fullWidth
        justify="center"
      />
    </StyledForm>
  );
};
