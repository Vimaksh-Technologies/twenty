import gql from 'graphql-tag';

export const GET_AUTHORIZED_MESSAGE_ATTACHMENTS = gql`
  query GetAuthorizedMessageAttachments($messageId: UUID!) {
    getAuthorizedMessageAttachments(messageId: $messageId) {
      id
      name
      mimeType
      size
      safetyState
      quarantineReason
      canDownload
    }
  }
`;
