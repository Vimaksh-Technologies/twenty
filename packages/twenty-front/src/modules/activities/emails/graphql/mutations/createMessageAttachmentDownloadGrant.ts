import gql from 'graphql-tag';

export const CREATE_MESSAGE_ATTACHMENT_DOWNLOAD_GRANT = gql`
  mutation CreateMessageAttachmentDownloadGrant(
    $messageId: UUID!
    $attachmentId: UUID!
  ) {
    createMessageAttachmentDownloadGrant(
      messageId: $messageId
      attachmentId: $attachmentId
    ) {
      url
      token
      expiresAt
    }
  }
`;
