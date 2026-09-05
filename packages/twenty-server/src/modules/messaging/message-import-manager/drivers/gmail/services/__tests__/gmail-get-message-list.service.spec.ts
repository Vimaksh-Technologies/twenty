import { Test, type TestingModule } from '@nestjs/testing';

import { google } from 'googleapis';
import {
  ConnectedAccountProvider,
  MessageFolderImportPolicy,
  MessageFolderPendingSyncAction,
} from 'twenty-shared/types';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { GmailGetHistoryService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-history.service';
import { GmailGetMessageListService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-message-list.service';
import { GmailMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-message-list-fetch-error-handler.service';
import { type MessageFolder } from 'src/modules/messaging/message-folder-manager/interfaces/message-folder-driver.interface';

jest.mock('googleapis', () => ({
  google: {
    gmail: jest.fn(),
  },
}));

const NOW = new Date('2026-09-05T12:34:56.789Z');
const INITIAL_SYNC_QUERY_CUTOFF = 'after:1780835696';

const createMockFolder = (
  overrides: Partial<MessageFolder> &
    Pick<MessageFolder, 'name' | 'externalId' | 'isSynced'>,
): MessageFolder => ({
  id: `folder-${overrides.externalId}`,
  syncCursor: null,
  isSentFolder: false,
  parentFolderId: null,
  pendingSyncAction: MessageFolderPendingSyncAction.NONE,
  ...overrides,
});

describe('GmailGetMessageListService', () => {
  let service: GmailGetMessageListService;
  let gmailGetHistoryService: {
    getHistory: jest.Mock;
    getMessageIdsFromHistory: jest.Mock;
  };
  let twentyConfigService: { get: jest.Mock };
  let messageList: jest.Mock;
  let messageGet: jest.Mock;
  let getProfile: jest.Mock;

  const connectedAccount: Pick<
    ConnectedAccountEntity,
    'provider' | 'id' | 'handle'
  > = {
    id: 'connected-account-id',
    provider: ConnectedAccountProvider.GOOGLE,
    handle: 'team@paryatech.in',
  };

  const inboxFolder = createMockFolder({
    name: 'INBOX',
    externalId: 'INBOX',
    isSynced: true,
  });

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    gmailGetHistoryService = {
      getHistory: jest.fn(),
      getMessageIdsFromHistory: jest.fn(),
    };
    twentyConfigService = {
      get: jest.fn().mockReturnValue(90),
    };
    messageList = jest.fn().mockResolvedValue({
      data: {
        messages: [{ id: 'message-1' }],
      },
    });
    messageGet = jest.fn().mockResolvedValue({
      data: {
        historyId: 'legacy-history-id',
      },
    });
    getProfile = jest.fn().mockResolvedValue({
      data: {
        historyId: 'forward-history-id',
      },
    });

    (google.gmail as jest.Mock).mockReturnValue({
      users: {
        messages: {
          list: messageList,
          get: messageGet,
        },
        getProfile,
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GmailGetMessageListService,
        {
          provide: GmailGetHistoryService,
          useValue: gmailGetHistoryService,
        },
        {
          provide: GoogleOAuth2ClientProvider,
          useValue: {
            getClient: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: GmailMessageListFetchErrorHandler,
          useValue: {
            handleError: jest.fn(),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: twentyConfigService,
        },
      ],
    }).compile();

    service = module.get(GmailGetMessageListService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should compose the selected-folder query with the initial lookback cutoff', async () => {
    const customersFolder = createMockFolder({
      name: 'Customers',
      externalId: 'Label_Customers',
      isSynced: true,
    });
    const unsyncedInboxFolder = createMockFolder({
      name: 'INBOX',
      externalId: 'INBOX',
      isSynced: false,
    });

    await service.getMessageLists({
      connectedAccount,
      messageChannel: {
        id: 'message-channel-id',
        syncCursor: '',
        messageFolderImportPolicy: MessageFolderImportPolicy.SELECTED_FOLDERS,
      },
      messageFolders: [customersFolder, unsyncedInboxFolder],
    });

    expect(messageList).toHaveBeenCalledWith({
      userId: 'me',
      maxResults: 500,
      pageToken: undefined,
      q: `label:customers -label:trash -label:spam -label:chat ${INITIAL_SYNC_QUERY_CUTOFF}`,
    });
  });

  it('should return a valid forward cursor when the initial query is empty', async () => {
    messageList.mockResolvedValue({
      data: {
        messages: [],
      },
    });

    await expect(
      service.getMessageLists({
        connectedAccount,
        messageChannel: {
          id: 'message-channel-id',
          syncCursor: '',
          messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
        },
        messageFolders: [inboxFolder],
      }),
    ).resolves.toEqual([
      {
        messageExternalIds: [],
        messageExternalIdsToDelete: [],
        previousSyncCursor: '',
        nextSyncCursor: 'forward-history-id',
        folderId: undefined,
      },
    ]);
    expect(getProfile).toHaveBeenCalledWith({ userId: 'me' });
  });

  it('should leave incremental cursor synchronization unchanged', async () => {
    gmailGetHistoryService.getHistory.mockResolvedValue({
      history: [{ id: 'history-entry' }],
      historyId: 'next-history-id',
    });
    gmailGetHistoryService.getMessageIdsFromHistory.mockResolvedValue({
      messagesAdded: ['added-message-id'],
      messagesDeleted: ['deleted-message-id'],
    });

    await expect(
      service.getMessageLists({
        connectedAccount,
        messageChannel: {
          id: 'message-channel-id',
          syncCursor: 'current-history-id',
          messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
        },
        messageFolders: [inboxFolder],
      }),
    ).resolves.toEqual([
      {
        messageExternalIds: ['added-message-id'],
        messageExternalIdsToDelete: ['deleted-message-id'],
        previousSyncCursor: 'current-history-id',
        nextSyncCursor: 'next-history-id',
        folderId: undefined,
      },
    ]);
    expect(messageList).not.toHaveBeenCalled();
    expect(gmailGetHistoryService.getHistory).toHaveBeenCalledWith(
      expect.anything(),
      'current-history-id',
    );
  });

  it.each([0, -1])(
    'should fail closed before initial synchronization for invalid lookback days: %s',
    async (lookbackDays) => {
      twentyConfigService.get.mockReturnValue(lookbackDays);

      await expect(
        service.getMessageLists({
          connectedAccount,
          messageChannel: {
            id: 'message-channel-id',
            syncCursor: '',
            messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
          },
          messageFolders: [inboxFolder],
        }),
      ).rejects.toThrow(
        'Initial sync lookback days must be a positive integer',
      );
      expect(messageList).not.toHaveBeenCalled();
    },
  );
});
