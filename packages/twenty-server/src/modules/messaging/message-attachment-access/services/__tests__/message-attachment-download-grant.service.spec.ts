import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';

describe('MessageAttachmentDownloadGrantService', () => {
  const authorizationService = {
    getAuthorizedDownloadAttachment: jest.fn(),
  };
  const cacheStorage = {
    get: jest.fn(),
    set: jest.fn(),
    setIfAbsent: jest.fn(),
    del: jest.fn(),
  };
  const twentyConfigService = {
    get: jest.fn(() => 'https://server.example.com'),
  };
  const service = new MessageAttachmentDownloadGrantService(
    authorizationService as unknown as MessageAttachmentAuthorizationService,
    cacheStorage as unknown as CacheStorageService,
    twentyConfigService as unknown as TwentyConfigService,
  );
  const attachment = {
    id: 'attachment-id',
    name: 'invoice.pdf',
    fileId: 'file-id',
    messageId: 'message-id',
    mimeType: 'application/pdf',
    size: 42,
    safetyState: 'ACCEPTED' as const,
    quarantineReason: null,
    canDownload: true,
  };
  const actor = {
    workspaceId: 'workspace-id',
    userWorkspaceId: 'user-workspace-id',
    userId: 'user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    authorizationService.getAuthorizedDownloadAttachment.mockResolvedValue(
      attachment,
    );
    cacheStorage.setIfAbsent.mockResolvedValue(true);
  });

  it('creates a short-lived actor, workspace, message, attachment, and file-bound grant', async () => {
    const grant = await service.createGrant({
      ...actor,
      messageId: 'message-id',
      attachmentId: 'attachment-id',
    });

    expect(grant).toEqual({
      url: 'https://server.example.com/message-attachments/attachment-id/download',
      token: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      expiresAt: expect.any(Date),
    });
    expect(cacheStorage.set).toHaveBeenCalledWith(
      expect.stringMatching(/^message-attachment-grant:/u),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        userWorkspaceId: 'user-workspace-id',
        userId: 'user-id',
        messageId: 'message-id',
        attachmentId: 'attachment-id',
        fileId: 'file-id',
      }),
      60_000,
    );
  });

  it('returns null instead of a grant when authorization fails', async () => {
    authorizationService.getAuthorizedDownloadAttachment.mockResolvedValue(
      null,
    );

    await expect(
      service.createGrant({
        ...actor,
        messageId: 'message-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toBeNull();
    expect(cacheStorage.set).not.toHaveBeenCalled();
  });

  it('atomically consumes a matching grant only once', async () => {
    const expiresAt = new Date(Date.now() + 30_000);

    cacheStorage.get.mockResolvedValue({
      ...actor,
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      fileId: 'file-id',
      expiresAt: expiresAt.toISOString(),
    });

    await expect(
      service.consumeGrant({
        token: 'grant-token',
        workspaceId: 'workspace-id',
        userWorkspaceId: 'user-workspace-id',
        userId: 'user-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toEqual(expect.objectContaining({ fileId: 'file-id' }));
    expect(cacheStorage.setIfAbsent).toHaveBeenCalledWith(
      'message-attachment-grant-used:grant-token',
      true,
      expect.any(Number),
    );
    expect(cacheStorage.del).toHaveBeenCalledWith(
      'message-attachment-grant:grant-token',
    );

    cacheStorage.setIfAbsent.mockResolvedValue(false);

    await expect(
      service.consumeGrant({
        token: 'grant-token',
        workspaceId: 'workspace-id',
        userWorkspaceId: 'user-workspace-id',
        userId: 'user-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toBeNull();
  });

  it('allows only one winner when matching grant consumes race', async () => {
    cacheStorage.get.mockResolvedValue({
      ...actor,
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      fileId: 'file-id',
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    let isConsumed = false;

    cacheStorage.setIfAbsent.mockImplementation(async () => {
      if (isConsumed) {
        return false;
      }

      isConsumed = true;

      return true;
    });

    const results = await Promise.all([
      service.consumeGrant({
        ...actor,
        token: 'grant-token',
        attachmentId: 'attachment-id',
      }),
      service.consumeGrant({
        ...actor,
        token: 'grant-token',
        attachmentId: 'attachment-id',
      }),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('rejects stale and cross-actor grants without consuming them', async () => {
    cacheStorage.get.mockResolvedValue({
      ...actor,
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      fileId: 'file-id',
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });

    await expect(
      service.consumeGrant({
        token: 'grant-token',
        workspaceId: 'workspace-id',
        userWorkspaceId: 'other-user-workspace-id',
        userId: 'other-user-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toBeNull();
    expect(cacheStorage.setIfAbsent).not.toHaveBeenCalled();
    expect(cacheStorage.del).not.toHaveBeenCalled();
  });
});
