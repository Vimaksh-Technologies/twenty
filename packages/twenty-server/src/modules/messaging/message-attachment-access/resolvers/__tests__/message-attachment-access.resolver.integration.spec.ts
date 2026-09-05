import { MessageAttachmentAccessResolver } from 'src/modules/messaging/message-attachment-access/resolvers/message-attachment-access.resolver';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';

describe('MessageAttachmentAccessResolver', () => {
  const authorizationService = {
    getAuthorizedAttachments: jest.fn(),
  };
  const downloadGrantService = { createGrant: jest.fn() };
  const resolver = new MessageAttachmentAccessResolver(
    authorizationService as unknown as MessageAttachmentAuthorizationService,
    downloadGrantService as unknown as MessageAttachmentDownloadGrantService,
  );
  const workspace = { id: 'workspace-id' };
  const user = { id: 'user-id' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only metadata selected by the authorization service', async () => {
    authorizationService.getAuthorizedAttachments.mockResolvedValue([
      {
        id: 'attachment-id',
        name: 'invoice.pdf',
        mimeType: 'application/pdf',
        size: 42,
        safetyState: 'ACCEPTED',
        quarantineReason: null,
        canDownload: true,
      },
    ]);

    await expect(
      resolver.getAuthorizedMessageAttachments(
        workspace as never,
        user as never,
        'user-workspace-id',
        'message-id',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'attachment-id', canDownload: true }),
    ]);
  });

  it('returns no grant when authorization denies or quarantines the attachment', async () => {
    downloadGrantService.createGrant.mockResolvedValue(null);

    await expect(
      resolver.createMessageAttachmentDownloadGrant(
        workspace as never,
        user as never,
        'user-workspace-id',
        'message-id',
        'attachment-id',
      ),
    ).resolves.toBeNull();
  });
});
