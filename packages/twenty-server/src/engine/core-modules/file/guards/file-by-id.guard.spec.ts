import { type ExecutionContext } from '@nestjs/common';

import { FileFolder } from 'twenty-shared/types';

import { FileByIdGuard } from 'src/engine/core-modules/file/guards/file-by-id.guard';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';

describe('FileByIdGuard', () => {
  it('rejects message attachments before evaluating a generic file token', async () => {
    const jwtWrapperService = {
      verifyJwtToken: jest.fn(),
      decode: jest.fn(),
    };
    const request = {
      params: {
        id: 'file-id',
        fileFolder: FileFolder.MessageAttachment,
      },
      query: { token: 'generic-file-token' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new FileByIdGuard(
      jwtWrapperService as unknown as JwtWrapperService,
    );

    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(jwtWrapperService.verifyJwtToken).not.toHaveBeenCalled();
    expect(jwtWrapperService.decode).not.toHaveBeenCalled();
  });
});
