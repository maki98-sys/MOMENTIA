import sharp from 'sharp';
import { DatabaseService } from '../database/database.service';
import { S3CompatibleStorageService } from './s3-compatible-storage.service';
import { MediaProcessingWorker } from './media-processing.worker';

describe('MediaProcessingWorker', () => {
  const client = { query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
  const database = {
    query: jest.fn(),
    transaction: jest.fn(async (operation: (txClient: typeof client) => Promise<unknown>) => operation(client)),
  } as unknown as DatabaseService;
  const storage = {
    getObjectBytes: jest.fn(),
    putObjectBytes: jest.fn().mockResolvedValue(undefined),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as S3CompatibleStorageService;

  beforeEach(() => {
    jest.clearAllMocks();
    (database.transaction as jest.Mock).mockImplementation(
      async (operation: (txClient: typeof client) => Promise<unknown>) => operation(client),
    );
    (storage.putObjectBytes as jest.Mock).mockResolvedValue(undefined);
    (storage.deleteObject as jest.Mock).mockResolvedValue(undefined);
  });

  it('re-encodes a validated image, stores three variants and marks the asset ready', async () => {
    const source = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 220, g: 40, b: 70 } },
    }).jpeg().toBuffer();
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'asset-1', storage_key_original: 'original/user-1/asset-1',
        size_bytes: String(source.length), status: 'processing',
      }],
    });
    (storage.getObjectBytes as jest.Mock).mockResolvedValue(source);

    const worker = new MediaProcessingWorker(database, storage);
    const internal = worker as unknown as {
      processJob: (job: { id: string; media_asset_id: string; attempts: number; max_attempts: number }) => Promise<void>;
    };
    await internal.processJob({
      id: 'job-1', media_asset_id: 'asset-1', attempts: 1, max_attempts: 5,
    });

    expect(storage.putObjectBytes).toHaveBeenCalledTimes(4);
    expect(storage.putObjectBytes).toHaveBeenNthCalledWith(
      1, 'processed/asset-1/original.webp', 'image/webp', expect.any(Buffer),
    );
    const sanitizedBytes = (storage.putObjectBytes as jest.Mock).mock.calls[0][2] as Buffer;
    const sanitizedMetadata = await sharp(sanitizedBytes).metadata();
    expect(sanitizedMetadata.format).toBe('webp');
    expect(sanitizedMetadata.exif).toBeUndefined();
    expect(storage.deleteObject).toHaveBeenCalledWith('original/user-1/asset-1');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'ready'"),
      expect.arrayContaining(['asset-1', 'processed/asset-1/original.webp']),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      expect.arrayContaining(['job-1']),
    );
  });

  it('retries corrupt image bytes and never marks the asset ready', async () => {
    (database.query as jest.Mock).mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        id: 'asset-2', storage_key_original: 'original/user-1/asset-2',
        size_bytes: '8', status: 'processing',
      }],
    });
    (storage.getObjectBytes as jest.Mock).mockResolvedValue(Buffer.from('not-image'));

    const worker = new MediaProcessingWorker(database, storage);
    const internal = worker as unknown as {
      processJob: (job: { id: string; media_asset_id: string; attempts: number; max_attempts: number }) => Promise<void>;
    };
    await internal.processJob({
      id: 'job-2', media_asset_id: 'asset-2', attempts: 1, max_attempts: 5,
    });

    expect(storage.putObjectBytes).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = $2"),
      ['asset-2', 'pending'],
    );
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
