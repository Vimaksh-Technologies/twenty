import { getAttachmentData } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/get-attachment-data.util';
import {
  GMAIL_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  validateGmailAttachment,
} from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/validate-gmail-attachment.util';

describe('Gmail attachment validation', () => {
  it('should recursively discover attachment references in nested MIME parts', () => {
    expect(
      getAttachmentData({
        payload: {
          parts: [
            {
              mimeType: 'multipart/alternative',
              parts: [
                {
                  filename: 'nested.pdf',
                  mimeType: 'application/pdf',
                  body: { attachmentId: 'nested-id', size: 12 },
                },
              ],
            },
            {
              filename: 'top.png',
              mimeType: 'image/png',
              body: { attachmentId: 'top-id', size: 8 },
            },
          ],
        },
      }),
    ).toEqual([
      {
        filename: 'nested.pdf',
        id: 'nested-id',
        mimeType: 'application/pdf',
        size: 12,
      },
      {
        filename: 'top.png',
        id: 'top-id',
        mimeType: 'image/png',
        size: 8,
      },
    ]);
  });

  it('should accept a PDF whose sanitized filename, MIME, extension, and magic bytes agree', async () => {
    await expect(
      validateGmailAttachment({
        attachment: {
          filename: '../../invoice\0.pdf',
          id: 'attachment-id',
          mimeType: 'application/pdf',
          size: 13,
        },
        content: Buffer.from('%PDF-1.7\nbody'),
      }),
    ).resolves.toEqual({
      safetyState: 'ACCEPTED',
      sanitizedFilename: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 13,
      quarantineReason: null,
    });
  });

  it('should replace an invalid sanitized filename with a deterministic non-sensitive placeholder', async () => {
    const invalidAttachment = {
      filename: '../../sensitive-customer/..',
      id: 'attachment-id',
      mimeType: 'application/pdf',
      size: 13,
    };

    const firstResult = await validateGmailAttachment({
      attachment: invalidAttachment,
      content: Buffer.from('%PDF-1.7\nbody'),
    });
    const retryResult = await validateGmailAttachment({
      attachment: invalidAttachment,
      content: Buffer.from('%PDF-1.7\nbody'),
    });

    expect(firstResult).toEqual(
      expect.objectContaining({
        safetyState: 'QUARANTINED',
        quarantineReason: 'INVALID_FILENAME',
        sanitizedFilename: expect.stringMatching(
          /^quarantined-[0-9a-f-]{36}\.bin$/,
        ),
      }),
    );
    expect(firstResult.sanitizedFilename).toBe(retryResult.sanitizedFilename);
    expect(firstResult.sanitizedFilename).not.toContain('sensitive-customer');
  });

  it.each([
    {
      description: 'empty content',
      attachment: {
        filename: 'empty.pdf',
        id: 'attachment-id',
        mimeType: 'application/pdf',
        size: 0,
      },
      content: Buffer.alloc(0),
      reason: 'EMPTY_FILE',
    },
    {
      description: 'oversized content',
      attachment: {
        filename: 'large.pdf',
        id: 'attachment-id',
        mimeType: 'application/pdf',
        size: GMAIL_ATTACHMENT_MAX_FILE_SIZE_BYTES + 1,
      },
      content: undefined,
      reason: 'FILE_TOO_LARGE',
    },
    {
      description: 'unsupported extension',
      attachment: {
        filename: 'archive.zip',
        id: 'attachment-id',
        mimeType: 'application/zip',
        size: 10,
      },
      content: undefined,
      reason: 'UNSUPPORTED_EXTENSION',
    },
    {
      description: 'active content',
      attachment: {
        filename: 'macro.xlsm',
        id: 'attachment-id',
        mimeType: 'application/vnd.ms-excel.sheet.macroenabled.12',
        size: 10,
      },
      content: undefined,
      reason: 'ACTIVE_CONTENT',
    },
    {
      description: 'declared MIME mismatch',
      attachment: {
        filename: 'invoice.pdf',
        id: 'attachment-id',
        mimeType: 'image/png',
        size: 12,
      },
      content: Buffer.from('%PDF-1.7\nbody'),
      reason: 'MIME_TYPE_MISMATCH',
    },
    {
      description: 'magic byte mismatch',
      attachment: {
        filename: 'invoice.pdf',
        id: 'attachment-id',
        mimeType: 'application/pdf',
        size: 9,
      },
      content: Buffer.from('not a pdf'),
      reason: 'MAGIC_BYTES_MISMATCH',
    },
    {
      description: 'declared size mismatch',
      attachment: {
        filename: 'invoice.pdf',
        id: 'attachment-id',
        mimeType: 'application/pdf',
        size: 99,
      },
      content: Buffer.from('%PDF-1.7\nbody'),
      reason: 'SIZE_MISMATCH',
    },
  ])(
    'should quarantine $description without accepting bytes',
    async ({ attachment, content, reason }) => {
      await expect(
        validateGmailAttachment({ attachment, content }),
      ).resolves.toEqual(
        expect.objectContaining({
          safetyState: 'QUARANTINED',
          quarantineReason: reason,
        }),
      );
    },
  );

  it('should quarantine CSV formula content as active', async () => {
    await expect(
      validateGmailAttachment({
        attachment: {
          filename: 'contacts.csv',
          id: 'attachment-id',
          mimeType: 'text/csv',
          size: 21,
        },
        content: Buffer.from('name,value\nAlice,=1+1'),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        safetyState: 'QUARANTINED',
        quarantineReason: 'ACTIVE_CONTENT',
      }),
    );
  });
});
