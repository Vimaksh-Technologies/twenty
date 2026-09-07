import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const TRANSITION_SUPPORT_CASE: TypedDocumentNode<
  ParyatechCrmMutationData<'TRANSITION_SUPPORT_CASE'>,
  ParyatechCrmMutationVariables<'TRANSITION_SUPPORT_CASE'>
> = gql`
  mutation TransitionSupportCase($input: TransitionSupportCaseInput!) {
    transitionSupportCase(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
