import { BadRequestException, ConflictException } from '@nestjs/common';
import { MediaService } from './media.service';
import { DatabaseService } from '../database/database.service';
import { S3CompatibleStorageService } from './s3-compatible-storage.service';

describe('MediaService', () => {
  const transactionClient = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
  const database = {
    query: jest.fn(),
    transaction: jest.fn(async (operation: (txClient: typeof transactionClient) => Promise<unknown>) => operation(transactionClient)),
  } as unknown as DatabaseService;
  const storage = {
    presignPut: jest.fn().mockResolvedValue('https://storage.example/signed'),
    headObject: jest.fn(),
    getObjectBytes: jest.fn(),
  } as unknown as S3CompatibleStorageService;
  const service = new MediaService(database, storage);
  const input = {
    fileName: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (database.query as jest.Mock).mockResolvedValue({ rowCount: 0, rows: [] });
    (database.transaction as jest.Mock).mockImplementation(
      async (operation: (txClient: typeof transactionClient) => Promise<unknown>) => operation(transactionClient),
    );
    (storage.presignPut as jest.Mock).mockResolvedValue('https://storage.example/signed');
  });

  it('rejects unsupported formats and oversized images before persistence', async () => {
    await expect(service.createUpload('user-1', 'key-1', { ...input, contentType: 'image/svg+xml' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createUpload('user-1', 'key-2', { ...input, sizeBytes: 26 * 1024 * 1024 }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('creates a private upload record and returns a short-lived signed PUT URL', async () => {
    const result = await service.createUpload('user-1', 'key-1', input);
    expect(result).toMatchObject({
      state: 'created', method: 'PUT', uploadUrl: 'https://storage.example/signed',
      requiredHeaders: { 'Content-Type': 'image/jpeg' }, expiresInSeconds: 600,
    });
    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.stringMatching(/^original\/user-1\//), 'image/jpeg', 600,
    );
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(transactionClient.query).toHaveBeenCalledTimes(2);
  });

  it('reuses an idempotent upload only when metadata matches', async () => {
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'upload-1', media_asset_id: 'asset-1', size_bytes: '1024',
        checksum_sha256_declared: 'a'.repeat(64), mime_type_declared: 'image/jpeg',
        storage_key_original: 'original/user-1/asset-1', state: 'created',
      }],
    });
    const result = await service.createUpload('user-1', 'key-1', input);
    expect(result).toMatchObject({ uploadId: 'upload-1', mediaAssetId: 'asset-1', state: 'created' });
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects completion when storage omits the Content-Type header', async () => {
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        upload_id: 'upload-1', media_asset_id: 'asset-1', state: 'created',
        storage_key_original: 'original/user-1/asset-1', size_bytes: '1024',
        mime_type_declared: 'image/jpeg',
      }],
    });
    (storage.headObject as jest.Mock).mockResolvedValue({ size: 1024, contentType: null });
    await expect(service.completeUpload('user-1', 'upload-1')).rejects.toBeInstanceOf(ConflictException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects completion when storage reports a different byte size', async () => {
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        upload_id: 'upload-1', media_asset_id: 'asset-1', state: 'created',
        storage_key_original: 'original/user-1/asset-1', size_bytes: '1024',
        mime_type_declared: 'image/jpeg',
      }],
    });
    (storage.headObject as jest.Mock).mockResolvedValue({ size: 1000, contentType: 'image/jpeg' });
    await expect(service.completeUpload('user-1', 'upload-1')).rejects.toBeInstanceOf(ConflictException);
    expect(database.transaction).not.toHaveBeenCalled();
  });
  it('verifies the actual PNG signature and SHA-256 before accepting an upload', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const checksum = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        upload_id: 'upload-1', media_asset_id: 'asset-1', state: 'created',
        storage_key_original: 'original/user-1/asset-1', size_bytes: String(bytes.length),
        mime_type_declared: 'image/png', checksum_sha256_declared: checksum,
      }],
    });
    (storage.headObject as jest.Mock).mockResolvedValue({ size: bytes.length, contentType: 'image/png' });
    (storage.getObjectBytes as jest.Mock).mockResolvedValue(bytes);

    const result = await service.completeUpload('user-1', 'upload-1');

    expect(result).toMatchObject({ state: 'uploaded', verified: true, processing: 'pending' });
    expect(storage.getObjectBytes).toHaveBeenCalledWith('original/user-1/asset-1', bytes.length);
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining('mime_type_detected = $2'),
      ['asset-1', 'image/png', checksum, 'user-1'],
    );
  });

  it('quarantines content when the bytes do not match the declared checksum', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        upload_id: 'upload-2', media_asset_id: 'asset-2', state: 'created',
        storage_key_original: 'original/user-1/asset-2', size_bytes: String(bytes.length),
        mime_type_declared: 'image/png', checksum_sha256_declared: 'f'.repeat(64),
      }],
    });
    (storage.headObject as jest.Mock).mockResolvedValue({ size: bytes.length, contentType: 'image/png' });
    (storage.getObjectBytes as jest.Mock).mockResolvedValue(bytes);

    await expect(service.completeUpload('user-1', 'upload-2')).rejects.toBeInstanceOf(ConflictException);
    expect(transactionClient.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'quarantined'"),
      ['asset-2', 'user-1'],
    );
  });

});
