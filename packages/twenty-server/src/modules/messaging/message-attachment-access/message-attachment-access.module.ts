import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FileMessageAttachmentModule } from 'src/engine/core-modules/file/file-message-attachment/file-message-attachment.module';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { ApplyMessagesVisibilityRestrictionsService } from 'src/modules/messaging/common/query-hooks/message/apply-messages-visibility-restrictions.service';
import { MessageAttachmentDownloadController } from 'src/modules/messaging/message-attachment-access/controllers/message-attachment-download.controller';
import { MessageAttachmentDownloadGuard } from 'src/modules/messaging/message-attachment-access/guards/message-attachment-download.guard';
import { MessageAttachmentAccessResolver } from 'src/modules/messaging/message-attachment-access/resolvers/message-attachment-access.resolver';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentCleanupService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-cleanup.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';

@Module({
  imports: [
    FileMessageAttachmentModule,
    PermissionsModule,
    TypeOrmModule.forFeature([
      ConnectedAccountEntity,
      MessageChannelEntity,
      UserWorkspaceEntity,
    ]),
  ],
  controllers: [MessageAttachmentDownloadController],
  providers: [
    ApplyMessagesVisibilityRestrictionsService,
    MessageAttachmentAccessResolver,
    MessageAttachmentAuthorizationService,
    MessageAttachmentCleanupService,
    MessageAttachmentDownloadGrantService,
    MessageAttachmentDownloadGuard,
  ],
  exports: [MessageAttachmentCleanupService],
})
export class MessageAttachmentAccessModule {}
