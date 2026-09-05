import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const TRANSITION_OPPORTUNITY: TypedDocumentNode<
  ParyatechCrmMutationData<'TRANSITION_OPPORTUNITY'>,
  ParyatechCrmMutationVariables<'TRANSITION_OPPORTUNITY'>
> = gql`
  mutation TransitionOpportunity($input: TransitionOpportunityInput!) {
    transitionOpportunity(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
