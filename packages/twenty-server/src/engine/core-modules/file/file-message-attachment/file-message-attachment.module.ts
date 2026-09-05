import { Module } from '@nestjs/common';

import { FileMessageAttachmentService } from 'src/engine/core-modules/file/file-message-attachment/services/file-message-attachment.service';

@Module({
  providers: [FileMessageAttachmentService],
  exports: [FileMessageAttachmentService],
})
export class FileMessageAttachmentModule {}
