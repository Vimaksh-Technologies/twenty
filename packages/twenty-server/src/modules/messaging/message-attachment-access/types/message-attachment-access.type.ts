export type MessageAttachmentActor = {
  workspaceId: string;
  userWorkspaceId: string;
  userId: string;
};

export type AuthorizedMessageAttachment = {
  id: string;
  name: string;
  fileId: string | null;
  messageId: string;
  mimeType: string;
  size: number;
  safetyState: 'ACCEPTED' | 'QUARANTINED';
  quarantineReason: string | null;
  canDownload: boolean;
};

export type MessageAttachmentGrantPayload = MessageAttachmentActor & {
  messageId: string;
  attachmentId: string;
  fileId: string;
  expiresAt: string;
};

export type AuthorizedMessageAttachmentDownload = Omit<
  AuthorizedMessageAttachment,
  'fileId'
> & {
  fileId: string;
};
