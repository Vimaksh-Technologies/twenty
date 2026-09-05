import { gql } from '@apollo/client';

export const RECORD_OUTREACH_OUTCOME = gql`
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
