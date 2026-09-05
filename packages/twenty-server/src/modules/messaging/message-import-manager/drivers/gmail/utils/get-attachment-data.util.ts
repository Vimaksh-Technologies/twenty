import { type gmail_v1 as gmailV1 } from 'googleapis';

export type GmailAttachmentReference = {
  filename: string;
  id: string;
  mimeType: string;
  size: number;
};

export const getAttachmentData = (
  message: gmailV1.Schema$Message,
): GmailAttachmentReference[] => {
  const attachments: GmailAttachmentReference[] = [];
  const pendingParts = [...(message.payload?.parts ?? [])].reverse();

  while (pendingParts.length > 0) {
    const part = pendingParts.pop();

    if (!part) {
      continue;
    }

    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        id: part.body.attachmentId,
        mimeType: part.mimeType ?? '',
        size: part.body.size ?? 0,
      });
    }

    if (part.parts) {
      for (let index = part.parts.length - 1; index >= 0; index--) {
        pendingParts.push(part.parts[index]);
      }
    }
  }

  return attachments;
};
