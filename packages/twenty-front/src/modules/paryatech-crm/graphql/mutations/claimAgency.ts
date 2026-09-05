import { gql } from '@apollo/client';

export const CLAIM_AGENCY = gql`
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
