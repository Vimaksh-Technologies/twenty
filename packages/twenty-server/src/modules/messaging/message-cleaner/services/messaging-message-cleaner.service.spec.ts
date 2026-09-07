import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { MessageAttachmentCleanupService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-cleanup.service';
import { MessagingMessageCleanerService } from 'src/modules/messaging/message-cleaner/services/messaging-message-cleaner.service';

describe('MessagingMessageCleanerService attachment cleanup', () => {
  it('removes attachment mirrors before deleting orphan messages', async () => {
    const associationRepository = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'association-id',
          messageId: 'message-id',
          messageExternalId: 'provider-message-id',
        },
      ]),
      delete: jest.fn(),
    };
    const messageRepository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'message-id', messageThreadId: 'thread-id' },
        ]),
      delete: jest.fn(),
    };
    const threadRepository = { find: jest.fn().mockResolvedValue([]) };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback: () => unknown) =>
        callback(),
      ),
      getRepository: jest.fn(
        async (_workspaceId: string, objectName: string) => {
          if (objectName === 'messageChannelMessageAssociation') {
            return associationRepository;
          }
          if (objectName === 'message') {
            return messageRepository;
          }

          return threadRepository;
        },
      ),
    };
    const attachmentCleanupService = {
      deleteOrphanedMessageAttachments: jest.fn(),
    };
    const service = new MessagingMessageCleanerService(
      globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
      attachmentCleanupService as unknown as MessageAttachmentCleanupService,
    );

    await service.deleteMessagesChannelMessageAssociationsAndRelatedOrphans({
      workspaceId: 'workspace-id',
      messageExternalIds: ['provider-message-id'],
      messageChannelId: 'message-channel-id',
    });

    expect(
      attachmentCleanupService.deleteOrphanedMessageAttachments,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      messageIds: ['message-id'],
    });
    expect(
      attachmentCleanupService.deleteOrphanedMessageAttachments.mock
        .invocationCallOrder[0],
    ).toBeLessThan(messageRepository.delete.mock.invocationCallOrder[0]);
  });
});
