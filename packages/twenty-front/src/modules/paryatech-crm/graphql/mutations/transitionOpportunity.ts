import { gql } from '@apollo/client';

export const TRANSITION_OPPORTUNITY = gql`
  mutation TransitionOpportunity($input: TransitionOpportunityInput!) {
    transitionOpportunity(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
