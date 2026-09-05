import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const RELEASE_AGENCY: TypedDocumentNode<
  ParyatechCrmMutationData<'RELEASE_AGENCY'>,
  ParyatechCrmMutationVariables<'RELEASE_AGENCY'>
> = gql`
  mutation ReleaseAgency($input: ReleaseAgencyInput!) {
    releaseAgency(input: $input) {
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
