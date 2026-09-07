import { Readable } from 'stream';

import { TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER } from 'twenty-shared/application';
import { FileFolder } from 'twenty-shared/types';
import { EntityNotFoundError } from 'typeorm';

import { FileStorageService } from 'src/engine/core-modules/file-storage/services/file-storage.service';
import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';

describe('FileMessageAttachmentService', () => {
  const fileStorageService = {
    readFile: jest.fn(),
    deleteByFileId: jest.fn(),
    deleteFile: jest.fn(),
  };
  const service = new FileMessageAttachmentService(
    fileStorageService as unknown as FileStorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    fileStorageService.deleteByFileId.mockResolvedValue(undefined);
  });

  it('reads only from the private message attachment folder', async () => {
    const stream = Readable.from('attachment');

    fileStorageService.readFile.mockResolvedValue(stream);

    await expect(
      service.readFile({
        workspaceId: 'workspace-id',
        messageId: 'message-id',
        attachmentId: 'attachment-id',
        filename: 'invoice.pdf',
      }),
    ).resolves.toBe(stream);
    expect(fileStorageService.readFile).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      fileFolder: FileFolder.MessageAttachment,
      resourcePath: 'message-id/attachment-id/invoice.pdf',
    });
  });

  it('deletes an accepted attachment by its immutable file id', async () => {
    await service.deleteFile({
      workspaceId: 'workspace-id',
      fileId: 'file-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      filename: 'renamed-invoice.pdf',
    });

    expect(fileStorageService.deleteByFileId).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      fileId: 'file-id',
      fileFolder: FileFolder.MessageAttachment,
    });
    expect(fileStorageService.deleteFile).not.toHaveBeenCalled();
  });

  it('idempotently falls back to the bounded path when the file row is absent', async () => {
    fileStorageService.deleteByFileId.mockRejectedValue(
      new EntityNotFoundError('File', { id: 'file-id' }),
    );

    await service.deleteFile({
      workspaceId: 'workspace-id',
      fileId: 'file-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      filename: 'invoice.pdf',
    });

    expect(fileStorageService.deleteFile).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION_UNIVERSAL_IDENTIFIER,
      fileFolder: FileFolder.MessageAttachment,
      resourcePath: 'message-id/attachment-id/invoice.pdf',
    });
  });

  it('deletes a possibly interrupted import by its bounded path', async () => {
    await service.deleteFile({
      workspaceId: 'workspace-id',
      fileId: null,
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      filename: 'invoice.pdf',
    });

    expect(fileStorageService.deleteByFileId).not.toHaveBeenCalled();
    expect(fileStorageService.deleteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        resourcePath: 'message-id/attachment-id/invoice.pdf',
      }),
    );
  });
});
