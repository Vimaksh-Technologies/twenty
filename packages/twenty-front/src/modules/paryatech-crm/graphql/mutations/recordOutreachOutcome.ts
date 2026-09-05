import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const RECORD_OUTREACH_OUTCOME: TypedDocumentNode<
  ParyatechCrmMutationData<'RECORD_OUTREACH_OUTCOME'>,
  ParyatechCrmMutationVariables<'RECORD_OUTREACH_OUTCOME'>
> = gql`
  mutation RecordOutreachOutcome($input: RecordOutreachOutcomeInput!) {
    recordOutreachOutcome(input: $input) {
      agencyId
      agencyLifecycle
      reservationStatus
      reservationClaimantId
      reservationExpiresAt
      recordOwnerId
      pendingExpiresAt
      firstAttemptedAt
      firstProviderAcceptedAt
      firstPendingUnknownAt
      firstContactedAt
      firstEngagedAt
    }
  }
`;
