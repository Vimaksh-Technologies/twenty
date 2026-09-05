import { CLAIM_AGENCY } from '@/paryatech-crm/graphql/mutations/claimAgency';
import { RECORD_OUTREACH_OUTCOME } from '@/paryatech-crm/graphql/mutations/recordOutreachOutcome';
import { RELEASE_AGENCY } from '@/paryatech-crm/graphql/mutations/releaseAgency';
import {
  type ParyatechCrmAction,
  type ParyatechCrmActionInput,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { useMutation } from '@apollo/client/react';

export const useExecuteParyatechCrmAction = () => {
  const [claimAgency, claimState] = useMutation(CLAIM_AGENCY);
  const [releaseAgency, releaseState] = useMutation(RELEASE_AGENCY);
  const [recordOutreachOutcome, outreachState] = useMutation(
    RECORD_OUTREACH_OUTCOME,
  );

  const execute = async (
    action: ParyatechCrmAction,
    input: ParyatechCrmActionInput,
  ) => {
    if (action === 'CLAIM_AGENCY') {
      return claimAgency({
        variables: {
          input: {
            agencyId: input.agencyId,
            reason: input.reason,
            evidence: input.evidence,
          },
        },
      });
    }

    if (action === 'RELEASE_AGENCY') {
      return releaseAgency({
        variables: {
          input: {
            agencyId: input.agencyId,
            reason: input.reason,
            evidence: input.evidence,
          },
        },
      });
    }

    return recordOutreachOutcome({ variables: { input } });
  };

  return {
    execute,
    loading:
      claimState.loading || releaseState.loading || outreachState.loading,
  };
};
