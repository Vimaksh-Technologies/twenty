import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const TRANSITION_AGREEMENT: TypedDocumentNode<
  ParyatechCrmMutationData<'TRANSITION_AGREEMENT'>,
  ParyatechCrmMutationVariables<'TRANSITION_AGREEMENT'>
> = gql`
  mutation TransitionAgreement($input: TransitionAgreementInput!) {
    transitionAgreement(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
