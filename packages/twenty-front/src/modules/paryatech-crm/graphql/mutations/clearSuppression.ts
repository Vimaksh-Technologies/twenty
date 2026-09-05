import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const CLEAR_SUPPRESSION: TypedDocumentNode<
  ParyatechCrmMutationData<'CLEAR_SUPPRESSION'>,
  ParyatechCrmMutationVariables<'CLEAR_SUPPRESSION'>
> = gql`
  mutation ClearSuppression($input: ClearSuppressionInput!) {
    clearSuppression(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
