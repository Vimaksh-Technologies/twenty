import { gql } from '@apollo/client';

export const GET_PARYATECH_CRM_AVAILABLE_ACTIONS = gql`
  query GetParyatechCrmAvailableActions(
    $objectName: String!
    $recordId: UUID!
  ) {
    getParyatechCrmAvailableActions(
      objectName: $objectName
      recordId: $recordId
    ) {
      action
      requiresReason
      requiresEvidence
    }
  }
`;
