import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const RECORD_SUBSTANTIVE_RESPONSE: TypedDocumentNode<
  ParyatechCrmMutationData<'RECORD_SUBSTANTIVE_RESPONSE'>,
  ParyatechCrmMutationVariables<'RECORD_SUBSTANTIVE_RESPONSE'>
> = gql`
  mutation RecordSubstantiveResponse($input: RecordSubstantiveResponseInput!) {
    recordSubstantiveResponse(input: $input) {
      recordId
      objectName
      state
      correction
    }
  }
`;
