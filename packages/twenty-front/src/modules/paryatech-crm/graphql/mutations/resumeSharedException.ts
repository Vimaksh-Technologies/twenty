import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const RESUME_SHARED_EXCEPTION: TypedDocumentNode<
  ParyatechCrmMutationData<'RESUME_SHARED_EXCEPTION'>,
  ParyatechCrmMutationVariables<'RESUME_SHARED_EXCEPTION'>
> = gql`
  mutation ResumeSharedException($input: ResumeSharedExceptionInput!) {
    resumeSharedException(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
