import { gql } from '@apollo/client';

export const RECORD_SUPPORT_RECEIPT = gql`
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
