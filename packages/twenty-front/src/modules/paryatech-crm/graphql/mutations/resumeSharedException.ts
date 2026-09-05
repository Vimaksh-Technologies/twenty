import { gql } from '@apollo/client';

export const RESUME_SHARED_EXCEPTION = gql`
  mutation ResumeSharedException($input: ResumeSharedExceptionInput!) {
    resumeSharedException(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
