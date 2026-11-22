import { readFile, stat } from 'fs/promises';
import { Readable } from 'stream';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

describe('MediaController streamed uploads', () => {
  const media = {
    assertUploadOwner: jest.fn(),
    receiveUploadFile: jest.fn(),
    receiveUploadPartFile: jest.fn(),
  };
  const controller = new MediaController(media as unknown as MediaService);
  const uploadId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => jest.clearAllMocks());

  it('stages a direct upload as a file and removes the temporary file afterwards', async () => {
    const payload = Buffer.from('streamed-direct-upload');
    let stagedPath = '';
    media.receiveUploadFile.mockImplementation(async (_userId: string, _id: string, filePath: string, size: number) => {
      stagedPath = filePath;
      expect(size).toBe(payload.length);
      expect(await readFile(filePath)).toEqual(payload);
      return { state: 'uploaded' };
    });
    const request = Object.assign(Readable.from([payload]), { userId: 'owner' });
    await expect(controller.uploadContent(request as never, uploadId, 'application/octet-stream'))
      .resolves.toEqual({ state: 'uploaded' });
    expect(media.assertUploadOwner).toHaveBeenCalledWith('owner', uploadId);
    expect(media.receiveUploadFile).toHaveBeenCalledTimes(1);
    await expect(stat(stagedPath)).rejects.toBeDefined();
  });

  it('stages resumable parts to disk and enforces ownership before storage', async () => {
    const payload = Buffer.from('streamed-part');
    const checksum = 'a'.repeat(64);
    let stagedPath = '';
    media.receiveUploadPartFile.mockImplementation(async (_userId: string, _id: string, _part: number, filePath: string, size: number, _checksum: string) => {
      stagedPath = filePath;
      expect(size).toBe(payload.length);
      expect(await readFile(filePath)).toEqual(payload);
      return { received: true };
    });
    const request = Object.assign(Readable.from([payload]), { userId: 'owner' });
    await expect(controller.uploadPart(request as never, uploadId, '0', 'application/octet-stream', checksum))
      .resolves.toEqual({ received: true });
    expect(media.assertUploadOwner).toHaveBeenCalledWith('owner', uploadId);
    expect(media.receiveUploadPartFile).toHaveBeenCalledWith('owner', uploadId, 0, stagedPath, payload.length, checksum);
    await expect(stat(stagedPath)).rejects.toBeDefined();
  });
});
