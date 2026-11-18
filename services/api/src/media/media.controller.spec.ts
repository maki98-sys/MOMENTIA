jest.mock('../auth/oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

describe('MediaController', () => {
  const media = {
    createUpload: jest.fn(),
    completeUpload: jest.fn(),
  } as unknown as MediaService;
  const controller = new MediaController(media);

  beforeEach(() => jest.clearAllMocks());

  it('creates an upload for the authenticated account with an idempotency key', async () => {
    (media.createUpload as jest.Mock).mockResolvedValue({ uploadId: 'upload-1' });
    await expect(controller.create(
      { userId: 'user-1' } as never,
      'request-123',
      { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 100, checksumSha256: 'a'.repeat(64) },
    )).resolves.toEqual({ upload: { uploadId: 'upload-1' } });
    expect(media.createUpload).toHaveBeenCalledWith('user-1', 'request-123', {
      fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 100, checksumSha256: 'a'.repeat(64),
    });
  });

  it('rejects missing idempotency keys and unexpected body fields', async () => {
    await expect(controller.create(
      { userId: 'user-1' } as never, undefined,
      { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 100, checksumSha256: 'a'.repeat(64) },
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create(
      { userId: 'user-1' } as never, 'key-1',
      { fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 100, checksumSha256: 'a'.repeat(64), ownerId: 'other' },
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(media.createUpload).not.toHaveBeenCalled();
  });

  it('normalizes MIME type and checksum input before passing it to the service', async () => {
    (media.createUpload as jest.Mock).mockResolvedValue({ uploadId: 'upload-1' });
    await controller.create(
      { userId: 'user-1' } as never, 'key-1',
      { fileName: ' Photo.JPG ', contentType: ' IMAGE/JPEG ', sizeBytes: 100, checksumSha256: 'a'.repeat(64) },
    );
    expect(media.createUpload).toHaveBeenCalledWith('user-1', 'key-1', {
      fileName: 'Photo.JPG', contentType: 'image/jpeg', sizeBytes: 100, checksumSha256: 'a'.repeat(64),
    });
  });

  it('requires an authenticated user and a valid upload UUID on completion', async () => {
    await expect(controller.complete({} as never, '550e8400-e29b-41d4-a716-446655440000'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.complete({ userId: 'user-1' } as never, 'not-a-uuid'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
