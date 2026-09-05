import { Injectable } from '@nestjs/common';

import { In, IsNull, Not } from 'typeorm';
import { isDefined } from 'twenty-shared/utils';

import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { type AttachmentWorkspaceEntity } from 'src/modules/attachment/standard-objects/attachment.workspace-entity';
import { type MessageWorkspaceEntity } from 'src/modules/messaging/common/standard-objects/message.workspace-entity';

@Injectable()
export class MessageAttachmentCleanupService {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    private readonly fileMessageAttachmentService: FileMessageAttachmentService,
  ) {}

  async deleteOrphanedMessageAttachments({
    workspaceId,
    messageIds,
  }: {
    workspaceId: string;
    messageIds: string[];
  }): Promise<void> {
    if (messageIds.length === 0) {
      return;
    }

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageRepository =
          await this.globalWorkspaceOrmManager.getRepository<MessageWorkspaceEntity>(
            workspaceId,
            'message',
            { shouldBypassPermissionChecks: true },
          );
        const orphanMessages = await messageRepository.find({
          where: {
            id: In(messageIds),
            messageChannelMessageAssociations: { id: IsNull() },
          },
        });
        const orphanMessageIds = orphanMessages.map(({ id }) => id);

        if (orphanMessageIds.length === 0) {
          return;
        }

        const attachmentRepository =
          await this.globalWorkspaceOrmManager.getRepository<AttachmentWorkspaceEntity>(
            workspaceId,
            'attachment',
            { shouldBypassPermissionChecks: true },
          );
        const attachments = await attachmentRepository.find({
          where: {
            messageId: In(orphanMessageIds),
            providerAttachmentId: Not(IsNull()),
          },
        });
        for (const attachment of attachments) {
          if (!isDefined(attachment.messageId) || !isDefined(attachment.name)) {
            continue;
          }

          await this.fileMessageAttachmentService.deleteFile({
            workspaceId,
            fileId: attachment.fileId ?? null,
            messageId: attachment.messageId,
            attachmentId: attachment.id,
            filename: attachment.name,
          });
        }

        if (attachments.length > 0) {
          await attachmentRepository.delete(
            attachments.map((attachment) => attachment.id),
          );
        }
      },
      authContext,
      { lite: true },
    );
  }
}
