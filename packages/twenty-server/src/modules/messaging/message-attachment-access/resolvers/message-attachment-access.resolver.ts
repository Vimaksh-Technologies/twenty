import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';
import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { PreventNestToAutoLogGraphqlErrorsFilter } from 'src/engine/core-modules/graphql/filters/prevent-nest-to-auto-log-graphql-errors.filter';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { RequireAccessTokenGuard } from 'src/engine/guards/require-access-token.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { MessageAttachmentDownloadGrantDTO } from 'src/modules/messaging/message-attachment-access/dtos/message-attachment-download-grant.dto';
import { MessageAttachmentDTO } from 'src/modules/messaging/message-attachment-access/dtos/message-attachment.dto';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';

@UseGuards(
  WorkspaceAuthGuard,
  RequireAccessTokenGuard,
  SettingsPermissionGuard(PermissionFlagType.DOWNLOAD_FILE),
)
@UsePipes(ResolverValidationPipe)
@UseFilters(PreventNestToAutoLogGraphqlErrorsFilter)
@MetadataResolver()
export class MessageAttachmentAccessResolver {
  constructor(
    private readonly authorizationService: MessageAttachmentAuthorizationService,
    private readonly downloadGrantService: MessageAttachmentDownloadGrantService,
  ) {}

  @Query(() => [MessageAttachmentDTO])
  async getAuthorizedMessageAttachments(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @Args('messageId', { type: () => UUIDScalarType }) messageId: string,
  ): Promise<MessageAttachmentDTO[]> {
    const attachments =
      await this.authorizationService.getAuthorizedAttachments({
        workspaceId: workspace.id,
        userWorkspaceId,
        userId: user.id,
        messageId,
      });

    return attachments.map(
      ({
        id,
        name,
        mimeType,
        size,
        safetyState,
        quarantineReason,
        canDownload,
      }) => ({
        id,
        name,
        mimeType,
        size,
        safetyState,
        quarantineReason,
        canDownload,
      }),
    );
  }

  @Mutation(() => MessageAttachmentDownloadGrantDTO, { nullable: true })
  createMessageAttachmentDownloadGrant(
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUser() user: UserEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @Args('messageId', { type: () => UUIDScalarType }) messageId: string,
    @Args('attachmentId', { type: () => UUIDScalarType }) attachmentId: string,
  ): Promise<MessageAttachmentDownloadGrantDTO | null> {
    return this.downloadGrantService.createGrant({
      workspaceId: workspace.id,
      userWorkspaceId,
      userId: user.id,
      messageId,
      attachmentId,
    });
  }
}
