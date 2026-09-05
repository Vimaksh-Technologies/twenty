import {
  type ParyatechCrmMutationData,
  type ParyatechCrmMutationVariables,
} from '@/paryatech-crm/types/ParyatechCrmAction';
import { gql, type TypedDocumentNode } from '@apollo/client';

export const RECORD_SUPPORT_RECEIPT: TypedDocumentNode<
  ParyatechCrmMutationData<'RECORD_SUPPORT_RECEIPT'>,
  ParyatechCrmMutationVariables<'RECORD_SUPPORT_RECEIPT'>
> = gql`
  mutation RecordSupportReceipt($input: RecordSupportReceiptInput!) {
    recordSupportReceipt(input: $input) {
      recordId
      objectName
      state
      correction
      replayed
    }
  }
`;
