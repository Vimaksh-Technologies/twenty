import { gql } from '@apollo/client';

export const RECORD_SUBSTANTIVE_RESPONSE = gql`
  mutation RecordSubstantiveResponse($input: RecordSubstantiveResponseInput!) {
    recordSubstantiveResponse(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
