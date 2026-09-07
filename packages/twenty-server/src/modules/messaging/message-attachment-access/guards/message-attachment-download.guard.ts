import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { type Request } from 'express';

import { type UserEntity } from 'src/engine/core-modules/user/user.entity';
import { type WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { MessageAttachmentAuthorizationService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-authorization.service';
import { MessageAttachmentDownloadGrantService } from 'src/modules/messaging/message-attachment-access/services/message-attachment-download-grant.service';
import { type AuthorizedMessageAttachmentDownload } from 'src/modules/messaging/message-attachment-access/types/message-attachment-access.type';

export type MessageAttachmentDownloadRequest = Request & {
  workspace: WorkspaceEntity;
  userWorkspaceId: string;
  user: UserEntity;
  messageAttachment?: AuthorizedMessageAttachmentDownload;
};

@Injectable()
export class MessageAttachmentDownloadGuard implements CanActivate {
  constructor(
    private readonly grantService: MessageAttachmentDownloadGrantService,
    private readonly authorizationService: MessageAttachmentAuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<MessageAttachmentDownloadRequest>();
    const token = request.headers['x-message-attachment-grant'];
    const attachmentId = request.params.attachmentId;

    if (
      typeof token !== 'string' ||
      typeof attachmentId !== 'string' ||
      request.workspace === undefined ||
      request.userWorkspaceId === undefined ||
      request.user === undefined
    ) {
      throw new NotFoundException();
    }

    const actor = {
      workspaceId: request.workspace.id,
      userWorkspaceId: request.userWorkspaceId,
      userId: request.user.id,
    };
    const grant = await this.grantService.consumeGrant({
      ...actor,
      token,
      attachmentId,
    });

    if (grant === null) {
      throw new NotFoundException();
    }

    const attachment =
      await this.authorizationService.getAuthorizedDownloadAttachment({
        ...actor,
        messageId: grant.messageId,
        attachmentId,
      });

    if (attachment === null || attachment.fileId !== grant.fileId) {
      throw new NotFoundException();
    }

    request.messageAttachment = attachment;

    return true;
  }
}
