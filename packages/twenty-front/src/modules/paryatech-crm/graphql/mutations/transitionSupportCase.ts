import { gql } from '@apollo/client';

export const TRANSITION_SUPPORT_CASE = gql`
  mutation TransitionSupportCase($input: TransitionSupportCaseInput!) {
    transitionSupportCase(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
