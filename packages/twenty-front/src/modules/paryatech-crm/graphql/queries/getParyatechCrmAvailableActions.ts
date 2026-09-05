import { gql } from '@apollo/client';

export const GET_PARYATECH_CRM_AVAILABLE_ACTIONS = gql`
  query GetParyatechCrmAvailableActions($agencyId: UUID!) {
    getParyatechCrmAvailableActions(agencyId: $agencyId) {
      action
      requiresReason
      requiresEvidence
    }
  }
`;
