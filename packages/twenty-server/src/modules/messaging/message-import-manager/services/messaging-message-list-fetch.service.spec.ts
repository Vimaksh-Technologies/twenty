import { MessageChannelSyncStatusService } from 'src/modules/messaging/common/services/message-channel-sync-status.service';
import { MessagingMessageCleanerService } from 'src/modules/messaging/message-cleaner/services/messaging-message-cleaner.service';
import { SyncMessageFoldersService } from 'src/modules/messaging/message-folder-manager/services/sync-message-folders.service';
import { MessagingCursorService } from 'src/modules/messaging/message-import-manager/services/messaging-cursor.service';
import { MessagingGetMessageListService } from 'src/modules/messaging/message-import-manager/services/messaging-get-message-list.service';
import { MessageImportExceptionHandlerService } from 'src/modules/messaging/message-import-manager/services/messaging-import-exception-handler.service';
import { MessagingMessageListFetchService } from 'src/modules/messaging/message-import-manager/services/messaging-message-list-fetch.service';
import { MessagingMessagesImportService } from 'src/modules/messaging/message-import-manager/services/messaging-messages-import.service';
import { MessagingProcessFolderActionsService } from 'src/modules/messaging/message-import-manager/services/messaging-process-folder-actions.service';
import { MessagingProcessGroupEmailActionsService } from 'src/modules/messaging/message-import-manager/services/messaging-process-group-email-actions.service';

describe('MessagingMessageListFetchService', () => {
  it('routes provider deletions through the cleaner that removes attachment mirrors', async () => {
    const cacheStorage = { del: jest.fn(), setAdd: jest.fn() };
    const syncStatusService = {
      markAsMessagesListFetchOngoing: jest.fn(),
      markAsMessageSyncCompleted: jest.fn(),
    };
    const associationRepository = { find: jest.fn().mockResolvedValue([]) };
    const globalWorkspaceOrmManager = {
      executeInWorkspaceContext: jest.fn(async (callback: () => unknown) =>
        callback(),
      ),
      getRepository: jest.fn().mockResolvedValue(associationRepository),
    };
    const getMessageListService = {
      getMessageLists: jest.fn().mockResolvedValue([
        {
          messageExternalIds: [],
          messageExternalIdsToDelete: ['provider-message-id'],
          previousSyncCursor: 'previous-cursor',
          nextSyncCursor: 'next-cursor',
          folderId: undefined,
        },
      ]),
    };
    const errorHandler = { handleDriverException: jest.fn() };
    const cleaner = {
      deleteMessagesChannelMessageAssociationsAndRelatedOrphans: jest.fn(),
    };
    const cursorService = { updateCursor: jest.fn() };
    const messagesImportService = { processMessageBatchImport: jest.fn() };
    const folderSyncService = {
      syncMessageFolders: jest.fn().mockResolvedValue([]),
    };
    const groupActionsService = { processGroupEmailActions: jest.fn() };
    const folderActionsService = { processFolderActions: jest.fn() };
    const service = new MessagingMessageListFetchService(
      cacheStorage as never,
      syncStatusService as unknown as MessageChannelSyncStatusService,
      globalWorkspaceOrmManager as never,
      { findOne: jest.fn() } as never,
      getMessageListService as unknown as MessagingGetMessageListService,
      errorHandler as unknown as MessageImportExceptionHandlerService,
      cleaner as unknown as MessagingMessageCleanerService,
      cursorService as unknown as MessagingCursorService,
      messagesImportService as unknown as MessagingMessagesImportService,
      folderSyncService as unknown as SyncMessageFoldersService,
      groupActionsService as unknown as MessagingProcessGroupEmailActionsService,
      folderActionsService as unknown as MessagingProcessFolderActionsService,
    );

    await service.processMessageListFetch(
      {
        id: 'message-channel-id',
        syncCursor: 'cursor',
        messageFolders: [],
        connectedAccount: { id: 'connected-account-id' },
      } as never,
      'workspace-id',
    );

    expect(
      cleaner.deleteMessagesChannelMessageAssociationsAndRelatedOrphans,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      messageExternalIds: ['provider-message-id'],
      messageChannelId: 'message-channel-id',
    });
  });
});
