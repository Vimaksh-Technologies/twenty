import { Injectable } from '@nestjs/common';

import { randomUUID } from 'crypto';

import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type MessageAttachmentDownloadGrantDTO } from 'src/modules/messaging/message-attachment-access/dtos/message-attachment-download-grant.dto';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import {
  type MessageAttachmentActor,
  type MessageAttachmentGrantPayload,
} from 'src/modules/messaging/message-attachment-access/types/message-attachment-access.type';

const MESSAGE_ATTACHMENT_GRANT_TTL_MS = 60_000;
const MESSAGE_ATTACHMENT_GRANT_KEY_PREFIX = 'message-attachment-grant:';
const MESSAGE_ATTACHMENT_GRANT_USED_KEY_PREFIX =
  'message-attachment-grant-used:';

@Injectable()
export class MessageAttachmentDownloadGrantService {
  constructor(
    private readonly authorizationService: MessageAttachmentAuthorizationService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorage: CacheStorageService,
    private readonly twentyConfigService: TwentyConfigService,
  ) {}

  async createGrant({
    messageId,
    attachmentId,
    ...actor
  }: MessageAttachmentActor & {
    messageId: string;
    attachmentId: string;
  }): Promise<MessageAttachmentDownloadGrantDTO | null> {
    const attachment =
      await this.authorizationService.getAuthorizedDownloadAttachment({
        ...actor,
        messageId,
        attachmentId,
      });

    if (attachment === null) {
      return null;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + MESSAGE_ATTACHMENT_GRANT_TTL_MS);
    const payload: MessageAttachmentGrantPayload = {
      ...actor,
      messageId,
      attachmentId,
      fileId: attachment.fileId,
      expiresAt: expiresAt.toISOString(),
    };

    await this.cacheStorage.set(
      `${MESSAGE_ATTACHMENT_GRANT_KEY_PREFIX}${token}`,
      payload,
      MESSAGE_ATTACHMENT_GRANT_TTL_MS,
    );

    return {
      url: `${this.twentyConfigService.get('SERVER_URL')}/message-attachments/${attachmentId}/download`,
      token,
      expiresAt,
    };
  }

  async consumeGrant({
    token,
    attachmentId,
    ...actor
  }: MessageAttachmentActor & {
    token: string;
    attachmentId: string;
  }): Promise<MessageAttachmentGrantPayload | null> {
    const grantKey = `${MESSAGE_ATTACHMENT_GRANT_KEY_PREFIX}${token}`;
    const payload =
      await this.cacheStorage.get<MessageAttachmentGrantPayload>(grantKey);

    if (
      payload === undefined ||
      payload.workspaceId !== actor.workspaceId ||
      payload.userWorkspaceId !== actor.userWorkspaceId ||
      payload.userId !== actor.userId ||
      payload.attachmentId !== attachmentId
    ) {
      return null;
    }

    const remainingLifetime =
      new Date(payload.expiresAt).getTime() - Date.now();

    if (remainingLifetime <= 0) {
      return null;
    }

    const didConsume = await this.cacheStorage.setIfAbsent(
      `${MESSAGE_ATTACHMENT_GRANT_USED_KEY_PREFIX}${token}`,
      true,
      remainingLifetime,
    );

    if (!didConsume) {
      return null;
    }

    await this.cacheStorage.del(grantKey);

    return payload;
  }
}
