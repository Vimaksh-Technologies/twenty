import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const CLAIM_AGENCY: TypedDocumentNode<
  ParyatechCrmMutationData<'CLAIM_AGENCY'>,
  ParyatechCrmMutationVariables<'CLAIM_AGENCY'>
> = gql`
  mutation ClaimAgency($input: ClaimAgencyInput!) {
    claimAgency(input: $input) {
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
