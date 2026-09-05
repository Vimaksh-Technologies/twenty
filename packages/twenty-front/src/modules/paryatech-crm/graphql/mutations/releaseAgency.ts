import { gql } from '@apollo/client';

export const RELEASE_AGENCY = gql`
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
