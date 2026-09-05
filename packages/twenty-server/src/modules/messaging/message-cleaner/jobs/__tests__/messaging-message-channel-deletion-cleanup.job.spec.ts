import { MessagingMessageChannelDeletionCleanupJob } from 'src/modules/messaging/message-cleaner/jobs/messaging-message-channel-deletion-cleanup.job';
import { MessagingMessageCleanerService } from 'src/modules/messaging/message-cleaner/services/messaging-message-cleaner.service';

describe('MessagingMessageChannelDeletionCleanupJob', () => {
  it('removes channel associations before cleaning messages and attachment mirrors', async () => {
    const messageCleanerService = {
      deleteMessageChannelMessageAssociationsByChannelId: jest
        .fn()
        .mockResolvedValue(undefined),
      cleanOrphanMessagesAndThreads: jest.fn().mockResolvedValue(undefined),
    };
    const job = new MessagingMessageChannelDeletionCleanupJob(
      messageCleanerService as unknown as MessagingMessageCleanerService,
    );

    await job.handle({
      workspaceId: 'workspace-id',
      messageChannelId: 'message-channel-id',
    });

    expect(
      messageCleanerService.deleteMessageChannelMessageAssociationsByChannelId,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      messageChannelId: 'message-channel-id',
    });
    expect(
      messageCleanerService.cleanOrphanMessagesAndThreads,
    ).toHaveBeenCalledWith('workspace-id');
    expect(
      messageCleanerService.deleteMessageChannelMessageAssociationsByChannelId
        .mock.invocationCallOrder[0],
    ).toBeLessThan(
      messageCleanerService.cleanOrphanMessagesAndThreads.mock
        .invocationCallOrder[0],
    );
  });
});
