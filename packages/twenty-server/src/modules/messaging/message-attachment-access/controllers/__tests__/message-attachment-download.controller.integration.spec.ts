import { Readable } from 'stream';

import { MessageAttachmentDownloadController } from 'src/modules/messaging/message-attachment-access/controllers/message-attachment-download.controller';
import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';

describe('MessageAttachmentDownloadController', () => {
  it('streams an authorized file with forced attachment disposition and no-store caching', async () => {
    const fileMessageAttachmentService = {
      readFile: jest.fn().mockResolvedValue(Readable.from('content')),
    };
    const controller = new MessageAttachmentDownloadController(
      fileMessageAttachmentService as unknown as FileMessageAttachmentService,
    );
    const request = {
      workspace: { id: 'workspace-id' },
      messageAttachment: {
        id: 'attachment-id',
        name: 'résumé.pdf',
        fileId: 'file-id',
        messageId: 'message-id',
        mimeType: 'text/html',
        size: 42,
        safetyState: 'ACCEPTED',
        quarantineReason: null,
        canDownload: true,
      },
    };

    const result = await controller.download(request as never);

    expect(fileMessageAttachmentService.readFile).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      messageId: 'message-id',
      attachmentId: 'attachment-id',
      filename: 'résumé.pdf',
    });
    expect(result.getHeaders()).toEqual({
      type: 'application/octet-stream',
      disposition:
        'attachment; filename="resume.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf',
      length: 42,
    });
  });
});
