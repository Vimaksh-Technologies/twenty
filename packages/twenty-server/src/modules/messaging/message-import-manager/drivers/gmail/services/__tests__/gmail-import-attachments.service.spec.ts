import { google } from 'googleapis';
import {
  ConnectedAccountProvider,
  MessageFolderImportPolicy,
} from 'twenty-shared/types';

import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import {
  GMAIL_ATTACHMENT_MAX_AGGREGATE_SIZE_BYTES,
  GMAIL_ATTACHMENT_MAX_MESSAGE_SIZE_BYTES,
  GmailImportAttachmentsService,
} from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-import-attachments.service';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { GmailGetMessagesService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-messages.service';
import { GmailMessagesImportErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-messages-import-error-handler.service';

jest.mock('googleapis', () => ({
  google: {
    gmail: jest.fn(),
  },
}));

const PDF_CONTENT = Buffer.from('%PDF-1.7\nbody');
const PDF_BASE64_URL = PDF_CONTENT.toString('base64url');
const LARGE_PDF_CONTENT = Buffer.concat([
  Buffer.from('%PDF-1.7\n'),
  Buffer.alloc(9 * 1024 * 1024, 0x20),
]);
const LARGE_PDF_BASE64_URL = LARGE_PDF_CONTENT.toString('base64url');

const attachment = (
  overrides: Partial<{
    filename: string;
    id: string;
    mimeType: string;
    size: number;
  }> = {},
) => ({
  filename: 'invoice.pdf',
  id: 'provider-attachment-id',
  mimeType: 'application/pdf',
  size: PDF_CONTENT.length,
  ...overrides,
});

describe('GmailImportAttachmentsService', () => {
  let service: GmailImportAttachmentsService;
  let attachmentsGet: jest.Mock;
  let fileWrite: jest.Mock;
  let repositoryFind: jest.Mock;
  let repositoryUpsert: jest.Mock;

  beforeEach(() => {
    attachmentsGet = jest.fn().mockResolvedValue({
      data: {
        data: PDF_BASE64_URL,
        size: PDF_CONTENT.length,
      },
    });
    fileWrite = jest.fn().mockResolvedValue({ id: 'stored-file-id' });
    repositoryFind = jest.fn().mockResolvedValue([]);
    repositoryUpsert = jest.fn().mockResolvedValue(undefined);

    const repository = {
      find: repositoryFind,
      upsert: repositoryUpsert,
    };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn((callback: () => unknown) =>
        callback(),
      ),
      getRepository: jest.fn().mockResolvedValue(repository),
    };

    service = new GmailImportAttachmentsService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      {
        writeFile: fileWrite,
      } as unknown as FileStorageService,
    );
  });

  const importAttachments = (
    messages = [
      {
        messageId: 'message-id',
        providerMessageId: 'provider-message-id',
        attachments: [attachment()],
      },
    ],
  ) =>
    service.importAttachments({
      gmailClient: {
        users: {
          messages: {
            attachments: {
              get: attachmentsGet,
            },
          },
        },
      } as never,
      connectedAccountId: 'connected-account-id',
      workspaceId: 'workspace-id',
      messages,
    });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should base64url-decode, validate, store, and relate an accepted attachment', async () => {
    await expect(importAttachments()).resolves.toEqual({
      imported: 1,
      quarantined: 0,
      skipped: 0,
    });

    expect(attachmentsGet).toHaveBeenCalledWith({
      userId: 'me',
      messageId: 'provider-message-id',
      id: 'provider-attachment-id',
    });
    expect(fileWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFile: PDF_CONTENT,
        fileFolder: 'message-attachment',
        workspaceId: 'workspace-id',
        fileId: expect.any(String),
        resourcePath: expect.stringMatching(
          /^message-id\/[0-9a-f-]+\/invoice\.pdf$/,
        ),
        settings: {
          isTemporaryFile: false,
          toDelete: false,
        },
      }),
    );
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'invoice.pdf',
        providerAttachmentId: 'provider-attachment-id',
        fileId: expect.any(String),
        mimeType: 'application/pdf',
        size: PDF_CONTENT.length,
        safetyState: 'ACCEPTED',
        quarantineReason: null,
        messageId: 'message-id',
      }),
      ['id'],
    );
    expect(repositoryUpsert.mock.calls[0][0]).not.toHaveProperty('file');
  });

  it('should skip an attachment already imported with its deterministic id', async () => {
    repositoryFind.mockResolvedValue([
      {
        providerAttachmentId: 'provider-attachment-id',
        messageId: 'message-id',
        safetyState: 'ACCEPTED',
      },
    ]);

    await expect(importAttachments()).resolves.toEqual({
      imported: 0,
      quarantined: 0,
      skipped: 1,
    });

    expect(attachmentsGet).not.toHaveBeenCalled();
    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).not.toHaveBeenCalled();
  });

  it('should quarantine a MIME or magic mismatch without writing bytes', async () => {
    attachmentsGet.mockResolvedValue({
      data: {
        data: Buffer.from('not a pdf').toString('base64url'),
        size: 9,
      },
    });

    await expect(
      importAttachments([
        {
          messageId: 'message-id',
          providerMessageId: 'provider-message-id',
          attachments: [attachment({ size: 9 })],
        },
      ]),
    ).resolves.toEqual({
      imported: 0,
      quarantined: 1,
      skipped: 0,
    });

    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: null,
        safetyState: 'QUARANTINED',
        quarantineReason: 'MAGIC_BYTES_MISMATCH',
        messageId: 'message-id',
      }),
      ['id'],
    );
  });

  it('should quarantine malformed base64url without writing suspect bytes', async () => {
    attachmentsGet.mockResolvedValue({
      data: {
        data: 'JVBERi0xLjcKYm9keQ*',
        size: PDF_CONTENT.length,
      },
    });

    await expect(importAttachments()).resolves.toEqual({
      imported: 0,
      quarantined: 1,
      skipped: 0,
    });

    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: null,
        safetyState: 'QUARANTINED',
        quarantineReason: 'MALFORMED_BASE64URL',
      }),
      ['id'],
    );
  });

  it('should enforce the per-message declared-size bound before fetching bytes', async () => {
    const messageAttachments = [0, 1, 2].map((index) =>
      attachment({
        id: `attachment-${index}`,
        size: Math.floor(GMAIL_ATTACHMENT_MAX_MESSAGE_SIZE_BYTES / 3) + 1,
      }),
    );

    await expect(
      importAttachments([
        {
          messageId: 'message-id',
          providerMessageId: 'provider-message-id',
          attachments: messageAttachments,
        },
      ]),
    ).resolves.toEqual({
      imported: 0,
      quarantined: 3,
      skipped: 0,
    });

    expect(attachmentsGet).not.toHaveBeenCalled();
    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).toHaveBeenCalledTimes(3);
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        quarantineReason: 'MESSAGE_SIZE_LIMIT_EXCEEDED',
      }),
      ['id'],
    );
  });

  it('should enforce the aggregate declared-size bound before fetching bytes', async () => {
    const perMessageSize = Math.floor(
      GMAIL_ATTACHMENT_MAX_AGGREGATE_SIZE_BYTES / 6,
    );
    const messages = Array.from({ length: 7 }, (_, index) => ({
      messageId: `message-${index}`,
      providerMessageId: `provider-message-${index}`,
      attachments: [
        attachment({ id: `attachment-${index}`, size: perMessageSize }),
      ],
    }));

    await expect(importAttachments(messages)).resolves.toEqual({
      imported: 0,
      quarantined: 7,
      skipped: 0,
    });

    expect(attachmentsGet).not.toHaveBeenCalled();
    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).toHaveBeenCalledTimes(7);
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        quarantineReason: 'AGGREGATE_SIZE_LIMIT_EXCEEDED',
      }),
      ['id'],
    );
  });

  it('should bound provider payload retention and stop fetching after the actual aggregate limit', async () => {
    let inFlightFetches = 0;
    let inFlightEncodedBytes = 0;
    let peakInFlightFetches = 0;
    let peakInFlightEncodedBytes = 0;

    attachmentsGet.mockImplementation(async () => {
      inFlightFetches++;
      inFlightEncodedBytes += LARGE_PDF_BASE64_URL.length;
      peakInFlightFetches = Math.max(peakInFlightFetches, inFlightFetches);
      peakInFlightEncodedBytes = Math.max(
        peakInFlightEncodedBytes,
        inFlightEncodedBytes,
      );

      await Promise.resolve();

      inFlightFetches--;
      inFlightEncodedBytes -= LARGE_PDF_BASE64_URL.length;

      return {
        data: {
          data: LARGE_PDF_BASE64_URL,
          size: LARGE_PDF_CONTENT.length,
        },
      };
    });

    const messages = Array.from({ length: 8 }, (_, index) => ({
      messageId: `message-${index}`,
      providerMessageId: `provider-message-${index}`,
      attachments: [
        attachment({
          id: `attachment-${index}`,
          size: 1,
        }),
      ],
    }));

    await expect(importAttachments(messages)).resolves.toEqual({
      imported: 0,
      quarantined: 8,
      skipped: 0,
    });

    expect(peakInFlightFetches).toBe(1);
    expect(peakInFlightEncodedBytes).toBeLessThanOrEqual(
      LARGE_PDF_BASE64_URL.length,
    );
    expect(attachmentsGet).toHaveBeenCalledTimes(6);
    expect(fileWrite).not.toHaveBeenCalled();
    expect(repositoryUpsert).toHaveBeenCalledTimes(8);

    for (const [metadata] of repositoryUpsert.mock.calls.slice(5)) {
      expect(metadata).toEqual(
        expect.objectContaining({
          fileId: null,
          quarantineReason: 'AGGREGATE_SIZE_LIMIT_EXCEEDED',
        }),
      );
    }
  });

  it('should retain retryable metadata with deterministic identifiers after storage failure', async () => {
    fileWrite.mockRejectedValueOnce(new Error('R2 unavailable'));
    repositoryFind.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        providerAttachmentId: 'provider-attachment-id',
        messageId: 'message-id',
        safetyState: 'IMPORTING',
      },
    ]);

    await expect(importAttachments()).rejects.toThrow('R2 unavailable');
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        providerAttachmentId: 'provider-attachment-id',
        fileId: null,
        safetyState: 'IMPORTING',
        messageId: 'message-id',
      }),
      ['id'],
    );

    await expect(importAttachments()).resolves.toEqual({
      imported: 1,
      quarantined: 0,
      skipped: 0,
    });

    const firstWrite = fileWrite.mock.calls[0][0];
    const retryWrite = fileWrite.mock.calls[1][0];

    expect(retryWrite.fileId).toBe(firstWrite.fileId);
    expect(retryWrite.resourcePath).toBe(firstWrite.resourcePath);
    expect(repositoryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        providerAttachmentId: 'provider-attachment-id',
        fileId: retryWrite.fileId,
        safetyState: 'ACCEPTED',
      }),
      ['id'],
    );
  });
});

describe('GmailGetMessagesService attachment references', () => {
  it('should explicitly request the full MIME payload used for attachment import', async () => {
    const messagesGet = jest.fn().mockResolvedValue({
      data: {
        id: 'provider-message-id',
        threadId: 'provider-thread-id',
        historyId: 'history-id',
        internalDate: '1788566400000',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'Message-ID', value: '<message@example.com>' },
            { name: 'From', value: 'sender@example.com' },
            { name: 'To', value: 'team@paryatech.in' },
          ],
          parts: [],
        },
      },
    });

    (google.gmail as jest.Mock).mockReturnValue({
      users: {
        messages: {
          get: messagesGet,
        },
      },
    });

    const service = new GmailGetMessagesService(
      {
        getClient: jest.fn().mockResolvedValue({}),
      } as unknown as GoogleOAuth2ClientProvider,
      {
        handleError: jest.fn(),
      } as unknown as GmailMessagesImportErrorHandler,
    );

    await service.getMessages(
      ['provider-message-id'],
      {
        id: 'connected-account-id',
        provider: ConnectedAccountProvider.GOOGLE,
        handle: 'team@paryatech.in',
        handleAliases: [],
      },
      {
        messageFolders: [],
        messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
      },
    );

    expect(messagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'provider-message-id',
      format: 'full',
    });
  });
});
