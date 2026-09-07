import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { PermissionFlagType } from 'twenty-shared/constants';

import { RequireAccessTokenGuard } from 'src/engine/guards/require-access-token.guard';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';
import {
  MessageAttachmentDownloadGuard,
  type MessageAttachmentDownloadRequest,
} from 'src/modules/messaging/message-attachment-access/guards/message-attachment-download.guard';

const MESSAGE_ATTACHMENT_MIME_TYPES = new Set([
  'application/csv',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/csv',
  'text/plain',
]);

const toAttachmentDisposition = (filename: string) => {
  const normalizedFilename = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '');
  const asciiFilename =
    normalizedFilename
      .replace(/[^\x20-\x7e]/gu, '_')
      .replace(/["\\]/gu, '_')
      .trim() || 'attachment';
  const encodedFilename = encodeURIComponent(
    filename.replace(/[\u0000-\u001f\u007f]/gu, '_'),
  ).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
};

const toSafeContentType = (mimeType: string) => {
  const normalizedMimeType = mimeType.toLowerCase();

  return MESSAGE_ATTACHMENT_MIME_TYPES.has(normalizedMimeType)
    ? normalizedMimeType
    : 'application/octet-stream';
};

@Controller('message-attachments')
@UseGuards(
  WorkspaceAuthGuard,
  RequireAccessTokenGuard,
  SettingsPermissionGuard(PermissionFlagType.DOWNLOAD_FILE),
  MessageAttachmentDownloadGuard,
)
export class MessageAttachmentDownloadController {
  constructor(
    private readonly fileMessageAttachmentService: FileMessageAttachmentService,
  ) {}

  @Get(':attachmentId/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @Header('Referrer-Policy', 'no-referrer')
  async download(
    @Req() request: MessageAttachmentDownloadRequest,
  ): Promise<StreamableFile> {
    const attachment = request.messageAttachment;

    if (attachment === undefined) {
      throw new NotFoundException();
    }

    const stream = await this.fileMessageAttachmentService.readFile({
      workspaceId: request.workspace.id,
      messageId: attachment.messageId,
      attachmentId: attachment.id,
      filename: attachment.name,
    });

    return new StreamableFile(stream, {
      type: toSafeContentType(attachment.mimeType),
      disposition: toAttachmentDisposition(attachment.name),
      length: attachment.size,
    });
  }
}
