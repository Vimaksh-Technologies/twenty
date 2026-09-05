import { PermissionFlagType } from 'twenty-shared/constants';

import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { ApplyMessagesVisibilityRestrictionsService } from 'src/modules/messaging/common/query-hooks/message/apply-messages-visibility-restrictions.service';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';

describe('MessageAttachmentAuthorizationService', () => {
  const attachmentRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  const messageRepository = { findOne: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => unknown) =>
      callback(),
    ),
    getRepository: jest.fn(async (_workspaceId: string, objectName: string) =>
      objectName === 'attachment' ? attachmentRepository : messageRepository,
    ),
  };
  const permissionsService = {
    userHasWorkspaceSettingPermission: jest.fn(),
  };
  const visibilityService = {
    applyMessagesVisibilityRestrictions: jest.fn(),
  };
  const service = new MessageAttachmentAuthorizationService(
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
    permissionsService as unknown as PermissionsService,
    visibilityService as unknown as ApplyMessagesVisibilityRestrictionsService,
  );
  const actor = {
    workspaceId: 'workspace-id',
    userWorkspaceId: 'user-workspace-id',
    userId: 'user-id',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    permissionsService.userHasWorkspaceSettingPermission.mockResolvedValue(
      true,
    );
    messageRepository.findOne.mockResolvedValue({
      id: 'message-id',
      text: 'visible body',
      subject: 'visible subject',
    });
    visibilityService.applyMessagesVisibilityRestrictions.mockImplementation(
      async (messages: unknown[]) => messages,
    );
  });

  it('returns metadata only when the actor can download and see the message', async () => {
    attachmentRepository.find.mockResolvedValue([
      {
        id: 'attachment-id',
        name: 'invoice.pdf',
        fileId: 'file-id',
        messageId: 'message-id',
        mimeType: 'application/pdf',
        size: 42,
        safetyState: 'ACCEPTED',
        quarantineReason: null,
      },
    ]);

    await expect(
      service.getAuthorizedAttachments({ ...actor, messageId: 'message-id' }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'attachment-id',
        messageId: 'message-id',
        canDownload: true,
      }),
    ]);
    expect(
      permissionsService.userHasWorkspaceSettingPermission,
    ).toHaveBeenCalledWith({
      userWorkspaceId: 'user-workspace-id',
      workspaceId: 'workspace-id',
      setting: PermissionFlagType.DOWNLOAD_FILE,
    });
    expect(
      visibilityService.applyMessagesVisibilityRestrictions,
    ).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'message-id' })],
      'workspace-id',
      'user-id',
    );
    expect(attachmentRepository.find).toHaveBeenCalledWith({
      where: {
        messageId: 'message-id',
        providerAttachmentId: expect.anything(),
      },
    });
  });

  it('returns no metadata when the actor lacks DOWNLOAD_FILE', async () => {
    permissionsService.userHasWorkspaceSettingPermission.mockResolvedValue(
      false,
    );

    await expect(
      service.getAuthorizedAttachments({ ...actor, messageId: 'message-id' }),
    ).resolves.toEqual([]);
    expect(messageRepository.findOne).not.toHaveBeenCalled();
    expect(attachmentRepository.find).not.toHaveBeenCalled();
  });

  it('returns no metadata when message-channel visibility restricts the body', async () => {
    visibilityService.applyMessagesVisibilityRestrictions.mockResolvedValue([]);

    await expect(
      service.getAuthorizedAttachments({ ...actor, messageId: 'message-id' }),
    ).resolves.toEqual([]);
    expect(attachmentRepository.find).not.toHaveBeenCalled();
  });

  it('does not grant a quarantined attachment', async () => {
    attachmentRepository.findOne.mockResolvedValue({
      id: 'attachment-id',
      name: 'quarantined.bin',
      fileId: null,
      messageId: 'message-id',
      mimeType: 'application/octet-stream',
      size: 42,
      safetyState: 'QUARANTINED',
      quarantineReason: 'ACTIVE_CONTENT',
    });

    await expect(
      service.getAuthorizedDownloadAttachment({
        ...actor,
        messageId: 'message-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toBeNull();
  });

  it('requires the attachment to belong to the requested message', async () => {
    attachmentRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getAuthorizedDownloadAttachment({
        ...actor,
        messageId: 'message-id',
        attachmentId: 'attachment-id',
      }),
    ).resolves.toBeNull();
    expect(attachmentRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'attachment-id',
        messageId: 'message-id',
        providerAttachmentId: expect.anything(),
      },
    });
  });
});
