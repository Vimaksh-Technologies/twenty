import { gql } from '@apollo/client';

export const TRANSITION_AGREEMENT = gql`
  mutation TransitionAgreement($input: TransitionAgreementInput!) {
    transitionAgreement(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
