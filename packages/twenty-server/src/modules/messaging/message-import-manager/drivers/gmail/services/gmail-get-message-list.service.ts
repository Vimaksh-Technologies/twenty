import { Injectable, Logger } from '@nestjs/common';

import { isNonEmptyString } from '@sniptt/guards';
import { google } from 'googleapis';

import { MessageFolderImportPolicy } from 'twenty-shared/types';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { type MessageFolderEntity } from 'src/engine/metadata-modules/message-folder/entities/message-folder.entity';
import {
  MessageImportDriverException,
  MessageImportDriverExceptionCode,
} from 'src/modules/messaging/message-import-manager/drivers/exceptions/message-import-driver.exception';
import { MESSAGING_GMAIL_USERS_MESSAGES_LIST_MAX_RESULT } from 'src/modules/messaging/message-import-manager/drivers/gmail/constants/messaging-gmail-users-messages-list-max-result.constant';
import { GmailGetHistoryService } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-get-history.service';
import { GmailMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/gmail/services/gmail-message-list-fetch-error-handler.service';
import { computeGmailExcludeSearchFilter } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/compute-gmail-exclude-search-filter.util';
import { computeGmailInitialSyncQuery } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/compute-gmail-initial-sync-query.util';
import { type GetMessageListsArgs } from 'src/modules/messaging/message-import-manager/types/get-message-lists-args.type';
import { type GetMessageListsResponse } from 'src/modules/messaging/message-import-manager/types/get-message-lists-response.type';

@Injectable()
export class GmailGetMessageListService {
  private readonly logger = new Logger(GmailGetMessageListService.name);
  constructor(
    private readonly gmailGetHistoryService: GmailGetHistoryService,
    private readonly googleOAuth2ClientProvider: GoogleOAuth2ClientProvider,
    private readonly gmailMessageListFetchErrorHandler: GmailMessageListFetchErrorHandler,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async getMessageListWithoutCursor(
    connectedAccount: Pick<
      ConnectedAccountEntity,
      'provider' | 'id' | 'handle'
    >,
    messageFolders: Pick<
      MessageFolderEntity,
      'name' | 'externalId' | 'isSynced' | 'parentFolderId'
    >[],
    messageChannel: Pick<MessageChannelEntity, 'messageFolderImportPolicy'>,
  ): Promise<GetMessageListsResponse> {
    const excludedSearchFilter = computeGmailExcludeSearchFilter(
      messageFolders,
      messageChannel.messageFolderImportPolicy,
    );
    const initialSyncQuery = computeGmailInitialSyncQuery({
      folderQuery: excludedSearchFilter,
      lookbackDays: this.twentyConfigService.get(
        'MESSAGING_INITIAL_SYNC_LOOKBACK_DAYS',
      ),
    });
    const oAuth2Client = await this.googleOAuth2ClientProvider.getClient(
      connectedAccount.id,
    );
    const gmailClient = google.gmail({
      version: 'v1',
      auth: oAuth2Client,
    });

    const profile = await gmailClient.users
      .getProfile({
        userId: 'me',
      })
      .catch((error) => {
        this.gmailMessageListFetchErrorHandler.handleError(error);
      });
    const nextSyncCursor = profile?.data.historyId;

    if (!nextSyncCursor) {
      throw new MessageImportDriverException(
        `No historyId found for connected account ${connectedAccount.id}`,
        MessageImportDriverExceptionCode.NO_NEXT_SYNC_CURSOR,
      );
    }

    let pageToken: string | undefined;
    let hasMoreMessages = true;

    const messageExternalIds: string[] = [];

    while (hasMoreMessages) {
      const messageList = await gmailClient.users.messages
        .list({
          userId: 'me',
          maxResults: MESSAGING_GMAIL_USERS_MESSAGES_LIST_MAX_RESULT,
          pageToken,
          q: initialSyncQuery,
        })
        .catch((error) => {
          this.logger.error(
            `Connected account ${connectedAccount.id}: Error fetching message list: ${error.message}`,
          );
          this.logger.error(
            `Connected account ${connectedAccount.id}: Error fetching message list: ${JSON.stringify(error)}`,
          );

          this.gmailMessageListFetchErrorHandler.handleError(error);

          return {
            data: {
              messages: [],
              nextPageToken: undefined,
            },
          };
        });

      const { messages } = messageList.data;
      const hasMessages = messages && messages.length > 0;

      if (!hasMessages) {
        break;
      }

      pageToken = messageList.data.nextPageToken ?? undefined;
      hasMoreMessages = !!pageToken;

      // @ts-expect-error legacy noImplicitAny
      messageExternalIds.push(...messages.map((message) => message.id));
    }

    return [
      {
        messageExternalIds,
        nextSyncCursor,
        previousSyncCursor: '',
        messageExternalIdsToDelete: [],
        folderId: undefined,
      },
    ];
  }

  public async getMessageLists({
    messageChannel,
    connectedAccount,
    messageFolders,
  }: GetMessageListsArgs): Promise<GetMessageListsResponse> {
    if (
      messageChannel.messageFolderImportPolicy ===
      MessageFolderImportPolicy.SELECTED_FOLDERS
    ) {
      const foldersToSync = messageFolders.filter((folder) => folder.isSynced);

      if (foldersToSync.length === 0) {
        this.logger.warn(
          `Connected account ${connectedAccount.id} Message Channel: ${messageChannel.id}: No folders to process`,
        );

        return [];
      }
    }

    if (!isNonEmptyString(messageChannel.syncCursor)) {
      return this.getMessageListWithoutCursor(
        connectedAccount,
        messageFolders,
        messageChannel,
      );
    }
    const oAuth2Client = await this.googleOAuth2ClientProvider.getClient(
      connectedAccount.id,
    );
    const gmailClient = google.gmail({
      version: 'v1',
      auth: oAuth2Client,
    });

    const { history, historyId: nextSyncCursor } =
      await this.gmailGetHistoryService.getHistory(
        gmailClient,
        messageChannel.syncCursor,
      );

    const { messagesAdded, messagesDeleted } =
      await this.gmailGetHistoryService.getMessageIdsFromHistory(history);

    if (!nextSyncCursor) {
      throw new MessageImportDriverException(
        `No nextSyncCursor found for connected account ${connectedAccount.id}`,
        MessageImportDriverExceptionCode.NO_NEXT_SYNC_CURSOR,
      );
    }

    return [
      {
        messageExternalIds: messagesAdded,
        messageExternalIdsToDelete: messagesDeleted,
        previousSyncCursor: messageChannel.syncCursor,
        nextSyncCursor,
        folderId: undefined,
      },
    ];
  }
}
