import { isUtf8 } from 'buffer';
import { basename, extname } from 'path';
import { v5 } from 'uuid';

import { type GmailAttachmentReference } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-attachment-data.util';

export const GMAIL_ATTACHMENT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_TYPES_BY_EXTENSION: Record<string, readonly string[]> = {
  '.csv': ['text/csv', 'application/csv'],
  '.jpeg': ['image/jpeg'],
  '.jpg': ['image/jpeg'],
  '.pdf': ['application/pdf'],
  '.png': ['image/png'],
  '.txt': ['text/plain'],
};

const ACTIVE_CONTENT_EXTENSIONS: Record<string, true> = {
  '.docm': true,
  '.htm': true,
  '.html': true,
  '.js': true,
  '.mjs': true,
  '.pptm': true,
  '.svg': true,
  '.xlsm': true,
};

const PDF_MAGIC = Buffer.from('%PDF-');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const ACTIVE_PDF_MARKERS = [
  Buffer.from('/JavaScript'),
  Buffer.from('/JS'),
  Buffer.from('/Launch'),
  Buffer.from('/EmbeddedFile'),
];

export type GmailAttachmentSafetyState = 'ACCEPTED' | 'QUARANTINED';

export type GmailAttachmentQuarantineReason =
  | 'ACTIVE_CONTENT'
  | 'AGGREGATE_SIZE_LIMIT_EXCEEDED'
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILENAME'
  | 'MAGIC_BYTES_MISMATCH'
  | 'MALFORMED_BASE64URL'
  | 'MESSAGE_SIZE_LIMIT_EXCEEDED'
  | 'MIME_TYPE_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'UNSUPPORTED_EXTENSION';

export type GmailAttachmentValidationResult = {
  safetyState: GmailAttachmentSafetyState;
  sanitizedFilename: string;
  mimeType: string;
  size: number;
  quarantineReason: GmailAttachmentQuarantineReason | null;
};

const quarantine = ({
  attachment,
  sanitizedFilename,
  content,
  quarantineReason,
}: {
  attachment: GmailAttachmentReference;
  sanitizedFilename: string;
  content?: Buffer;
  quarantineReason: GmailAttachmentQuarantineReason;
}): GmailAttachmentValidationResult => ({
  safetyState: 'QUARANTINED',
  sanitizedFilename,
  mimeType: attachment.mimeType,
  size: content?.length ?? attachment.size,
  quarantineReason,
});

const sanitizeFilename = (filename: string): string => {
  const normalizedFilename = filename.normalize('NFKC').replace(/\\/g, '/');
  let printableFilename = '';

  for (const character of normalizedFilename) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && codePoint >= 32 && codePoint !== 127) {
      printableFilename += character;
    }
  }

  return basename(printableFilename.trim());
};

const getQuarantinedFilename = (providerAttachmentId: string): string =>
  `quarantined-${v5(
    `gmail-attachment-filename\0${providerAttachmentId}`,
    v5.URL,
  )}.bin`;

const contentMatchesExtension = (
  extension: string,
  content: Buffer,
): boolean => {
  switch (extension) {
    case '.pdf':
      return content.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
    case '.png':
      return content.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);
    case '.jpg':
    case '.jpeg':
      return content.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
    case '.csv':
    case '.txt':
      return isUtf8(content) && !content.includes(0);
    default:
      return false;
  }
};

const containsActiveContent = (extension: string, content: Buffer): boolean => {
  if (extension === '.pdf') {
    return ACTIVE_PDF_MARKERS.some((marker) => content.includes(marker));
  }

  if (extension === '.csv') {
    return /(?:^|[\r\n,;])[\s\uFEFF]*["']?[\s\uFEFF]*[=+\-@]/u.test(
      content.toString('utf8'),
    );
  }

  return false;
};

export const validateGmailAttachment = async ({
  attachment,
  content,
}: {
  attachment: GmailAttachmentReference;
  content?: Buffer;
}): Promise<GmailAttachmentValidationResult> => {
  const sanitizedFilename = sanitizeFilename(attachment.filename);

  if (
    sanitizedFilename.length === 0 ||
    sanitizedFilename.length > 255 ||
    sanitizedFilename === '.' ||
    sanitizedFilename === '..'
  ) {
    return quarantine({
      attachment,
      sanitizedFilename: getQuarantinedFilename(attachment.id),
      content,
      quarantineReason: 'INVALID_FILENAME',
    });
  }

  const extension = extname(sanitizedFilename).toLowerCase();

  if (ACTIVE_CONTENT_EXTENSIONS[extension]) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'ACTIVE_CONTENT',
    });
  }

  const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_EXTENSION[extension];

  if (!allowedMimeTypes) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'UNSUPPORTED_EXTENSION',
    });
  }

  if (!allowedMimeTypes.includes(attachment.mimeType.toLowerCase())) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'MIME_TYPE_MISMATCH',
    });
  }

  const size = content?.length ?? attachment.size;

  if (size <= 0) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'EMPTY_FILE',
    });
  }

  if (size > GMAIL_ATTACHMENT_MAX_FILE_SIZE_BYTES) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'FILE_TOO_LARGE',
    });
  }

  if (content && content.length !== attachment.size) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'SIZE_MISMATCH',
    });
  }

  if (content && !contentMatchesExtension(extension, content)) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'MAGIC_BYTES_MISMATCH',
    });
  }

  if (content && containsActiveContent(extension, content)) {
    return quarantine({
      attachment,
      sanitizedFilename,
      content,
      quarantineReason: 'ACTIVE_CONTENT',
    });
  }

  return {
    safetyState: 'ACCEPTED',
    sanitizedFilename,
    mimeType: attachment.mimeType.toLowerCase(),
    size,
    quarantineReason: null,
  };
};
