import { type ExecutionContext, NotFoundException } from '@nestjs/common';

import { MessageAttachmentDownloadGuard } from 'src/modules/messaging/message-attachment-access/guards/message-attachment-download.guard';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';

const buildContext = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('MessageAttachmentDownloadGuard', () => {
  const grantService = { consumeGrant: jest.fn() };
  const authorizationService = {
    getAuthorizedDownloadAttachment: jest.fn(),
  };
  const guard = new MessageAttachmentDownloadGuard(
    grantService as unknown as MessageAttachmentDownloadGrantService,
    authorizationService as unknown as MessageAttachmentAuthorizationService,
  );
  const attachment = {
    id: 'attachment-id',
    name: 'invoice.pdf',
    fileId: 'file-id',
    messageId: 'message-id',
    mimeType: 'application/pdf',
    size: 42,
    safetyState: 'ACCEPTED',
    quarantineReason: null,
    canDownload: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    grantService.consumeGrant.mockResolvedValue({
      workspaceId: 'workspace-id',
      userWorkspaceId: 'user-workspace-id',
      userId: 'user-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      fileId: 'file-id',
    });
    authorizationService.getAuthorizedDownloadAttachment.mockResolvedValue(
      attachment,
    );
  });

  it('rechecks current permission and visibility at download time', async () => {
    const request = {
      headers: { 'x-message-attachment-grant': 'grant-token' },
      params: { attachmentId: 'attachment-id' },
      workspace: { id: 'workspace-id' },
      userWorkspaceId: 'user-workspace-id',
      user: { id: 'user-id' },
    };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(grantService.consumeGrant).toHaveBeenCalledWith({
      token: 'grant-token',
      workspaceId: 'workspace-id',
      userWorkspaceId: 'user-workspace-id',
      userId: 'user-id',
      attachmentId: 'attachment-id',
    });
    expect(
      authorizationService.getAuthorizedDownloadAttachment,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      userWorkspaceId: 'user-workspace-id',
      userId: 'user-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
    });
    expect(request).toHaveProperty('messageAttachment', attachment);
  });

  it('hides stale, replayed, cross-actor, and mismatched-file grants', async () => {
    grantService.consumeGrant.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        buildContext({
          headers: { 'x-message-attachment-grant': 'grant-token' },
          params: { attachmentId: 'attachment-id' },
          workspace: { id: 'workspace-id' },
          userWorkspaceId: 'user-workspace-id',
          user: { id: 'user-id' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    grantService.consumeGrant.mockResolvedValue({
      workspaceId: 'workspace-id',
      userWorkspaceId: 'user-workspace-id',
      userId: 'user-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      fileId: 'different-file-id',
    });

    await expect(
      guard.canActivate(
        buildContext({
          headers: { 'x-message-attachment-grant': 'grant-token' },
          params: { attachmentId: 'attachment-id' },
          workspace: { id: 'workspace-id' },
          userWorkspaceId: 'user-workspace-id',
          user: { id: 'user-id' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('fails closed when permission or relation is revoked after grant creation', async () => {
    authorizationService.getAuthorizedDownloadAttachment.mockResolvedValue(
      null,
    );

    await expect(
      guard.canActivate(
        buildContext({
          headers: { 'x-message-attachment-grant': 'grant-token' },
          params: { attachmentId: 'attachment-id' },
          workspace: { id: 'workspace-id' },
          userWorkspaceId: 'user-workspace-id',
          user: { id: 'user-id' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a grant carried in the URL query string', async () => {
    await expect(
      guard.canActivate(
        buildContext({
          headers: {},
          query: { grant: 'grant-token' },
          params: { attachmentId: 'attachment-id' },
          workspace: { id: 'workspace-id' },
          userWorkspaceId: 'user-workspace-id',
          user: { id: 'user-id' },
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(grantService.consumeGrant).not.toHaveBeenCalled();
  });
});
