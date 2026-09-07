import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageAttachmentCleanupService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-cleanup.service';

describe('MessageAttachmentCleanupService', () => {
  const messageRepository = { find: jest.fn() };
  const attachmentRepository = { find: jest.fn(), delete: jest.fn() };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async (callback: () => unknown) =>
      callback(),
    ),
    getRepository: jest.fn(async (_workspaceId: string, objectName: string) =>
      objectName === 'message' ? messageRepository : attachmentRepository,
    ),
  };
  const fileMessageAttachmentService = { deleteFile: jest.fn() };
  const service = new MessageAttachmentCleanupService(
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
    fileMessageAttachmentService as unknown as FileMessageAttachmentService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes bytes and metadata only for orphaned messages', async () => {
    messageRepository.find.mockResolvedValue([{ id: 'orphan-message-id' }]);
    attachmentRepository.find.mockResolvedValue([
      {
        id: 'accepted-id',
        name: 'invoice.pdf',
        messageId: 'orphan-message-id',
        fileId: 'file-id',
      },
      {
        id: 'quarantined-id',
        name: 'unsafe.html',
        messageId: 'orphan-message-id',
        fileId: null,
      },
    ]);

    await service.deleteOrphanedMessageAttachments({
      workspaceId: 'workspace-id',
      messageIds: ['orphan-message-id', 'still-associated-message-id'],
    });
    expect(attachmentRepository.find).toHaveBeenCalledWith({
      where: {
        messageId: expect.anything(),
        providerAttachmentId: expect.anything(),
      },
    });

    expect(fileMessageAttachmentService.deleteFile).toHaveBeenNthCalledWith(1, {
      workspaceId: 'workspace-id',
      fileId: 'file-id',
      messageId: 'orphan-message-id',
      attachmentId: 'accepted-id',
      filename: 'invoice.pdf',
    });
    expect(fileMessageAttachmentService.deleteFile).toHaveBeenNthCalledWith(2, {
      workspaceId: 'workspace-id',
      fileId: null,
      messageId: 'orphan-message-id',
      attachmentId: 'quarantined-id',
      filename: 'unsafe.html',
    });
    expect(attachmentRepository.delete).toHaveBeenCalledWith([
      'accepted-id',
      'quarantined-id',
    ]);
  });

  it('does nothing when no candidate message is orphaned', async () => {
    messageRepository.find.mockResolvedValue([]);

    await service.deleteOrphanedMessageAttachments({
      workspaceId: 'workspace-id',
      messageIds: ['still-associated-message-id'],
    });

    expect(attachmentRepository.find).not.toHaveBeenCalled();
    expect(fileMessageAttachmentService.deleteFile).not.toHaveBeenCalled();
    expect(attachmentRepository.delete).not.toHaveBeenCalled();
  });
});
