import { Injectable } from '@nestjs/common';

import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { FileFolder } from 'twenty-shared/types';
import { EntityNotFoundError } from 'typeorm';

import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';

@Injectable()
export class FileMessageAttachmentService {
  constructor(private readonly fileStorageService: FileStorageService) {}

  readFile({
    workspaceId,
    messageId,
    attachmentId,
    filename,
  }: {
    workspaceId: string;
    messageId: string;
    attachmentId: string;
    filename: string;
  }) {
    return this.fileStorageService.readFile({
      workspaceId,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      fileFolder: FileFolder.MessageAttachment,
      resourcePath: `${messageId}/${attachmentId}/${filename}`,
    });
  }

  async deleteFile({
    workspaceId,
    fileId,
    messageId,
    attachmentId,
    filename,
  }: {
    workspaceId: string;
    fileId: string | null;
    messageId: string;
    attachmentId: string;
    filename: string;
  }): Promise<void> {
    if (fileId !== null) {
      try {
        await this.fileStorageService.deleteByFileId({
          workspaceId,
          fileId,
          fileFolder: FileFolder.MessageAttachment,
        });

        return;
      } catch (error) {
        if (!(error instanceof EntityNotFoundError)) {
          throw error;
        }
      }
    }

    await this.fileStorageService.deleteFile({
      workspaceId,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      fileFolder: FileFolder.MessageAttachment,
      resourcePath: `${messageId}/${attachmentId}/${filename}`,
    });
  }
}
