import { Injectable } from '@nestjs/common';

import {
  FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED,
  PermissionFlagType,
} from 'twenty-shared/constants';
import { IsNull, Not } from 'typeorm';

import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { ApplyMessagesVisibilityRestrictionsService } from 'src/modules/messaging/common/query-hooks/message/apply-messages-visibility-restrictions.service';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';
import {
  type AuthorizedMessageAttachment,
  type AuthorizedMessageAttachmentDownload,
  type MessageAttachmentActor,
} from 'src/modules/messaging/message-attachment-access/types/message-attachment-access.type';

@Injectable()
export class MessageAttachmentAuthorizationService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly permissionsService: PermissionsService,
    private readonly applyMessagesVisibilityRestrictionsService: ApplyMessagesVisibilityRestrictionsService,
  ) {}

  async getAuthorizedAttachments({
    messageId,
    ...actor
  }: MessageAttachmentActor & {
    messageId: string;
  }): Promise<AuthorizedMessageAttachment[]> {
    if (!(await this.canAccessMessage({ ...actor, messageId }))) {
      return [];
    }

    const authContext = buildSystemAuthContext(actor.workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const attachmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<AttachmentWorkspaceEntity>(
            actor.workspaceId,
            'attachment',
            { shouldBypassPermissionChecks: true },
          );
        const attachments = await attachmentRepository.find({
          where: { messageId, providerAttachmentId: Not(IsNull()) },
        });

        return attachments.map((attachment) =>
          this.toAuthorizedAttachment(attachment, messageId),
        );
      },
      authContext,
      { lite: true },
    );
  }

  async getAuthorizedDownloadAttachment({
    messageId,
    attachmentId,
    ...actor
  }: MessageAttachmentActor & {
    messageId: string;
    attachmentId: string;
  }): Promise<AuthorizedMessageAttachmentDownload | null> {
    if (!(await this.canAccessMessage({ ...actor, messageId }))) {
      return null;
    }

    const authContext = buildSystemAuthContext(actor.workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const attachmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<AttachmentWorkspaceEntity>(
            actor.workspaceId,
            'attachment',
            { shouldBypassPermissionChecks: true },
          );
        const attachment = await attachmentRepository.findOne({
          where: {
            id: attachmentId,
            messageId,
            providerAttachmentId: Not(IsNull()),
          },
        });

        if (
          attachment?.safetyState !== 'ACCEPTED' ||
          attachment.fileId === null ||
          attachment.fileId === undefined
        ) {
          return null;
        }

        return {
          ...this.toAuthorizedAttachment(attachment, messageId),
          fileId: attachment.fileId,
        };
      },
      authContext,
      { lite: true },
    );
  }

  private async canAccessMessage({
    workspaceId,
    userWorkspaceId,
    userId,
    messageId,
  }: MessageAttachmentActor & { messageId: string }): Promise<boolean> {
    const canDownload =
      await this.permissionsService.userHasWorkspaceSettingPermission({
        userWorkspaceId,
        workspaceId,
        setting: PermissionFlagType.DOWNLOAD_FILE,
      });

    if (!canDownload) {
      return false;
    }

    const authContext = buildSystemAuthContext(workspaceId);
    const message =
      await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
        async () => {
          const messageRepository =
            await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
              workspaceId,
              'message',
              { shouldBypassPermissionChecks: true },
            );

          return messageRepository.findOne({ where: { id: messageId } });
        },
        authContext,
        { lite: true },
      );

    if (message === null) {
      return false;
    }

    const [visibleMessage] =
      await this.applyMessagesVisibilityRestrictionsService.applyMessagesVisibilityRestrictions(
        [{ ...message }],
        workspaceId,
        userId,
      );

    return (
      visibleMessage?.text !== undefined &&
      visibleMessage.text !== FIELD_RESTRICTED_ADDITIONAL_PERMISSIONS_REQUIRED
    );
  }

  private toAuthorizedAttachment(
    attachment: AttachmentWorkspaceEntity,
    messageId: string,
  ): AuthorizedMessageAttachment {
    const safetyState =
      attachment.safetyState === 'ACCEPTED' ? 'ACCEPTED' : 'QUARANTINED';

    return {
      id: attachment.id,
      name: attachment.name ?? 'attachment',
      fileId: attachment.fileId ?? null,
      messageId,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      size: attachment.size ?? 0,
      safetyState,
      quarantineReason: attachment.quarantineReason ?? null,
      canDownload: safetyState === 'ACCEPTED' && attachment.fileId !== null,
    };
  }
}
