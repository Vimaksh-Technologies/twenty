import { CLAIM_AGENCY } from '@/paryatech-crm/graphql/mutations/claimAgency';
import { CLEAR_SUPPRESSION } from '@/paryatech-crm/graphql/mutations/clearSuppression';
import { RECORD_OUTREACH_OUTCOME } from '@/paryatech-crm/graphql/mutations/recordOutreachOutcome';
import { RECORD_SUBSTANTIVE_RESPONSE } from '@/paryatech-crm/graphql/mutations/recordSubstantiveResponse';
import { RECORD_SUPPORT_RECEIPT } from '@/paryatech-crm/graphql/mutations/recordSupportReceipt';
import { RELEASE_AGENCY } from '@/paryatech-crm/graphql/mutations/releaseAgency';
import { RESUME_SHARED_EXCEPTION } from '@/paryatech-crm/graphql/mutations/resumeSharedException';
import { TRANSITION_AGREEMENT } from '@/paryatech-crm/graphql/mutations/transitionAgreement';
import { TRANSITION_OPPORTUNITY } from '@/paryatech-crm/graphql/mutations/transitionOpportunity';
import { TRANSITION_SUPPORT_CASE } from '@/paryatech-crm/graphql/mutations/transitionSupportCase';
import { type ParyatechCrmActionExecution } from '@/paryatech-crm/types/ParyatechCrmAction';
import { useMutation } from '@apollo/client/react';

export const useExecuteParyatechCrmAction = () => {
  const [claimAgency, claimState] = useMutation(CLAIM_AGENCY);
  const [releaseAgency, releaseState] = useMutation(RELEASE_AGENCY);
  const [recordOutreachOutcome, outreachState] = useMutation(
    RECORD_OUTREACH_OUTCOME,
  );
  const [transitionOpportunity, opportunityState] = useMutation(
    TRANSITION_OPPORTUNITY,
  );
  const [transitionAgreement, agreementState] =
    useMutation(TRANSITION_AGREEMENT);
  const [recordSupportReceipt, receiptState] = useMutation(
    RECORD_SUPPORT_RECEIPT,
  );
  const [clearSuppression, suppressionState] = useMutation(CLEAR_SUPPRESSION);
  const [recordSubstantiveResponse, responseState] = useMutation(
    RECORD_SUBSTANTIVE_RESPONSE,
  );
  const [transitionSupportCase, caseState] = useMutation(
    TRANSITION_SUPPORT_CASE,
  );
  const [resumeSharedException, exceptionState] = useMutation(
    RESUME_SHARED_EXCEPTION,
  );

  const execute = (execution: ParyatechCrmActionExecution) => {
    switch (execution.action) {
      case 'CLAIM_AGENCY':
        return claimAgency({ variables: { input: execution.input } });
      case 'RELEASE_AGENCY':
        return releaseAgency({ variables: { input: execution.input } });
      case 'RECORD_OUTREACH_OUTCOME':
        return recordOutreachOutcome({
          variables: { input: execution.input },
        });
      case 'TRANSITION_OPPORTUNITY':
        return transitionOpportunity({
          variables: { input: execution.input },
        });
      case 'TRANSITION_AGREEMENT':
        return transitionAgreement({
          variables: { input: execution.input },
        });
      case 'RECORD_SUPPORT_RECEIPT':
        return recordSupportReceipt({
          variables: { input: execution.input },
        });
      case 'CLEAR_SUPPRESSION':
        return clearSuppression({ variables: { input: execution.input } });
      case 'RECORD_SUBSTANTIVE_RESPONSE':
        return recordSubstantiveResponse({
          variables: { input: execution.input },
        });
      case 'TRANSITION_SUPPORT_CASE':
        return transitionSupportCase({
          variables: { input: execution.input },
        });
      case 'RESUME_SHARED_EXCEPTION':
        return resumeSharedException({
          variables: { input: execution.input },
        });
    }
  };

  return {
    execute,
    loading: [
      claimState,
      releaseState,
      outreachState,
      opportunityState,
      agreementState,
      receiptState,
      suppressionState,
      responseState,
      caseState,
      exceptionState,
    ].some(({ loading }) => loading),
  };
};
