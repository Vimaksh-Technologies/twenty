import { gql } from '@apollo/client';

export const CLEAR_SUPPRESSION = gql`
  mutation ClearSuppression($input: ClearSuppressionInput!) {
    clearSuppression(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
