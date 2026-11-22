import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { MediaService } from '../src/media/media.service';
import { MediaProcessingService } from '../src/media/media-processing.service';
import { MediaStorage } from '../src/media/media-storage.service';

describe('Media resumable upload PostgreSQL lifecycle', () => {
  let pool: Pool;
  let database: DatabaseService;
  let service: MediaService;
  let processing: MediaProcessingService;
  let userId: string;
  let otherUserId: string;
  let assetId: string;
  let uploadId: string;
  const objects = new Map<string, Buffer>();
  const storage = {
    put: jest.fn(async (key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); }),
    read: jest.fn(async (key: string) => {
      const value = objects.get(key);
      if (!value) throw new Error('Object not found');
      return Buffer.from(value);
    }),
    remove: jest.fn(async (key: string) => { objects.delete(key); }),
    locate: jest.fn(),
    openReadStream: jest.fn(),
  } as unknown as MediaStorage;

  const file = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x01, 0x02]);
  const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

  async function seedUpload(expectedChecksum = sha256(file)) {
    userId = randomUUID();
    otherUserId = randomUUID();
    assetId = randomUUID();
    uploadId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active')`,
      [userId, `media-${userId}@momentia.test`, otherUserId, `media-${otherUserId}@momentia.test`],
    );
    await pool.query(
      `INSERT INTO media_assets(
         id,owner_id,storage_key_original,storage_provider,original_filename,
         mime_type_detected,size_bytes,checksum_sha256,status
       ) VALUES($1,$2,$3,'local','photo.jpg','application/octet-stream',$4,$5,'pending')`,
      [assetId, userId, `pending/${userId}/${assetId}`, file.length, expectedChecksum],
    );
    await pool.query(
      `INSERT INTO media_uploads(
         id,media_asset_id,uploader_id,state,bytes_received,idempotency_key,
         declared_mime_type,request_fingerprint,expires_at
       ) VALUES($1,$2,$3,'created',0,$4,'image/jpeg',$5,now()+interval '1 hour')`,
      [uploadId, assetId, userId, `media-e2e-${uploadId}`, 'a'.repeat(64)],
    );
  }

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for media E2E tests.');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    database = new DatabaseService(pool);
    service = new MediaService(database, storage);
    processing = new MediaProcessingService(database);
  });

  beforeEach(() => { objects.clear(); jest.clearAllMocks(); });

  afterEach(async () => {
    if (!userId) return;
    await pool.query('DELETE FROM storage_usage_events WHERE user_id=ANY($1::uuid[])', [[userId, otherUserId]]);
    await pool.query('DELETE FROM media_assets WHERE owner_id=ANY($1::uuid[])', [[userId, otherUserId]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[userId, otherUserId]]);
    userId = '';
    otherUserId = '';
  });

  afterAll(async () => { await pool?.end(); });

  it('rejects another account before storing an upload part', async () => {
    await seedUpload();
    const bytes = Buffer.from('private-part');
    await expect(
      service.receiveUploadPart(otherUserId, uploadId, 0, bytes, sha256(bytes)),
    ).rejects.toMatchObject({ status: 404 });
    expect(storage.put).not.toHaveBeenCalled();
    const parts = await pool.query('SELECT 1 FROM media_upload_parts WHERE upload_id=$1', [uploadId]);
    expect(parts.rowCount).toBe(0);
  });

  it('assembles out-of-order parts only after contiguous sequence and full-file checksum validation', async () => {
    await seedUpload();
    const first = file.subarray(0, 4);
    const second = file.subarray(4);
    await service.receiveUploadPart(userId, uploadId, 1, second, sha256(second));
    await service.receiveUploadPart(userId, uploadId, 0, first, sha256(first));

    const completed = await service.completeResumableUpload(userId, uploadId);
    expect(completed).toMatchObject({ state: 'uploaded', asset_status: 'quarantined' });

    const asset = await pool.query('SELECT status FROM media_assets WHERE id=$1', [assetId]);
    expect(asset.rows[0].status).toBe('quarantined');
    const jobs = await pool.query(
      'SELECT job_type,status FROM media_processing_jobs WHERE media_asset_id=$1 ORDER BY job_type',
      [assetId],
    );
    expect(jobs.rows.map(row => row.job_type).sort()).toEqual(['inspect', 'virus_scan']);
    const parts = await pool.query('SELECT 1 FROM media_upload_parts WHERE upload_id=$1', [uploadId]);
    expect(parts.rowCount).toBe(0);
    const cleanup = await pool.query(
      `SELECT count(*)::int total FROM media_storage_deletions
       WHERE media_asset_id=$1 AND storage_key LIKE 'parts/%'`,
      [assetId],
    );
    expect(cleanup.rows[0].total).toBe(2);
    expect(objects.get(`pending/${userId}/${assetId}`)).toEqual(file);
  });

  it('rejects a final file checksum mismatch and returns the upload to uploading state', async () => {
    await seedUpload('0'.repeat(64));
    await service.receiveUploadPart(userId, uploadId, 0, file, sha256(file));
    await expect(service.completeResumableUpload(userId, uploadId)).rejects.toThrow('Final file checksum mismatch.');
    const upload = await pool.query('SELECT state FROM media_uploads WHERE id=$1', [uploadId]);
    expect(upload.rows[0].state).toBe('uploading');
    const asset = await pool.query('SELECT status FROM media_assets WHERE id=$1', [assetId]);
    expect(asset.rows[0].status).toBe('pending');
    expect(objects.has(`pending/${userId}/${assetId}`)).toBe(false);
  });


  it('dead-letters a storage deletion after the twelfth failed attempt and stops reclaiming it', async () => {
    await seedUpload();
    const storageKey = `pending/${userId}/retry-exhaustion`;
    await pool.query(
      `INSERT INTO media_storage_deletions(
         media_asset_id,storage_key,storage_provider,attempts,max_attempts,status
       ) VALUES($1,$2,'local',11,12,'pending')`,
      [assetId, storageKey],
    );

    const workerId = 'media-e2e-worker';
    const [task] = await processing.claimDeletions(workerId, 10);
    expect(task).toMatchObject({ storage_key: storageKey, attempts: 12 });

    await expect(processing.completeDeletion(workerId, String(task.id), {
      success: false,
      errorCode: 'STORAGE_UNAVAILABLE',
    })).resolves.toMatchObject({ status: 'failed' });

    const persisted = await pool.query(
      `SELECT attempts,max_attempts,dead_lettered_at,last_error_code
       FROM media_storage_deletions WHERE id=$1`,
      [task.id],
    );
    expect(persisted.rows[0].attempts).toBe(12);
    expect(persisted.rows[0].max_attempts).toBe(12);
    expect(persisted.rows[0].dead_lettered_at).not.toBeNull();
    expect(persisted.rows[0].last_error_code).toBe('RETRY_EXHAUSTED:STORAGE_UNAVAILABLE');
    await expect(processing.claimDeletions(workerId, 10)).resolves.toHaveLength(0);
  });

  it('dead-letters an exhausted deletion when its worker lease expires', async () => {
    await seedUpload();
    const storageKey = `pending/${userId}/expired-final-lease`;
    await pool.query(
      `INSERT INTO media_storage_deletions(
         media_asset_id,storage_key,storage_provider,attempts,max_attempts,status,locked_at,locked_by
       ) VALUES($1,$2,'local',12,12,'processing',now()-interval '10 minutes','stale-media-worker')`,
      [assetId, storageKey],
    );

    await expect(processing.releaseStaleLocks(60)).resolves.toMatchObject({ released: 1 });

    const persisted = await pool.query(
      `SELECT status,attempts,dead_lettered_at,last_error_code
       FROM media_storage_deletions WHERE media_asset_id=$1 AND storage_key=$2`,
      [assetId, storageKey],
    );
    expect(persisted.rows[0]).toMatchObject({
      status: 'failed',
      attempts: 12,
      last_error_code: 'RETRY_EXHAUSTED:WORKER_LEASE_EXPIRED',
    });
    expect(persisted.rows[0].dead_lettered_at).not.toBeNull();
    await expect(processing.claimDeletions('media-e2e-worker', 10)).resolves.toHaveLength(0);
  });

  it('expires an assembling upload and queues original plus part objects before completion can publish', async () => {
    await seedUpload();
    const part = file.subarray(0, 4);
    const partChecksum = sha256(part);
    await service.receiveUploadPart(userId, uploadId, 0, part, partChecksum);
    await pool.query(
      `UPDATE media_uploads SET state='assembling',expires_at=now()-interval '1 minute' WHERE id=$1`,
      [uploadId],
    );

    await expect(processing.cleanupExpiredUploads(100)).resolves.toMatchObject({
      expired: 1,
      removedParts: 1,
    });

    const upload = await pool.query('SELECT state,last_error_code FROM media_uploads WHERE id=$1', [uploadId]);
    expect(upload.rows[0]).toMatchObject({ state: 'cancelled', last_error_code: 'UPLOAD_EXPIRED' });
    const asset = await pool.query('SELECT status FROM media_assets WHERE id=$1', [assetId]);
    expect(asset.rows[0].status).toBe('deleted');
    const parts = await pool.query('SELECT 1 FROM media_upload_parts WHERE upload_id=$1', [uploadId]);
    expect(parts.rowCount).toBe(0);

    const queued = await pool.query(
      `SELECT storage_key FROM media_storage_deletions
       WHERE media_asset_id=$1 ORDER BY storage_key`,
      [assetId],
    );
    expect(queued.rows.map(row => row.storage_key).sort()).toEqual([
      `parts/${userId}/${uploadId}/0-${partChecksum}`,
      `pending/${userId}/${assetId}`,
    ].sort());
    await expect(service.completeResumableUpload(userId, uploadId)).rejects.toMatchObject({ status: 409 });
  });

  it('serializes an in-flight assembly against expiry cleanup without publishing the asset', async () => {
    await seedUpload();
    const part = Buffer.from(file);
    await service.receiveUploadPart(userId, uploadId, 0, part, sha256(part));
    await pool.query(
      `UPDATE media_uploads SET expires_at=now()-interval '1 minute' WHERE id=$1`,
      [uploadId],
    );

    let markReadStarted!: () => void;
    let releaseRead!: () => void;
    const readStarted = new Promise<void>(resolve => { markReadStarted = resolve; });
    const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
    storage.read.mockImplementationOnce(async (key: string) => {
      markReadStarted();
      await readGate;
      const value = objects.get(key);
      if (!value) throw new Error('Object not found');
      return Buffer.from(value);
    });

    const assembly = service.completeResumableUpload(userId, uploadId);
    await readStarted;
    await expect(processing.cleanupExpiredUploads(100)).resolves.toMatchObject({
      expired: 1,
      removedParts: 1,
    });
    releaseRead();

    await expect(assembly).rejects.toMatchObject({ status: 409 });
    const upload = await pool.query('SELECT state,last_error_code FROM media_uploads WHERE id=$1', [uploadId]);
    expect(upload.rows[0]).toMatchObject({ state: 'cancelled', last_error_code: 'UPLOAD_EXPIRED' });
    const asset = await pool.query('SELECT status FROM media_assets WHERE id=$1', [assetId]);
    expect(asset.rows[0].status).toBe('deleted');
    expect(objects.has(`pending/${userId}/${assetId}`)).toBe(false);
    const jobs = await pool.query('SELECT 1 FROM media_processing_jobs WHERE media_asset_id=$1', [assetId]);
    expect(jobs.rowCount).toBe(0);
  });

  it('cancels an incomplete upload, queues fragment cleanup and refuses further parts', async () => {
    await seedUpload();
    const part = file.subarray(0, 4);
    await service.receiveUploadPart(userId, uploadId, 0, part, sha256(part));
    await expect(service.cancelUpload(userId, uploadId)).resolves.toMatchObject({
      cancelled: true,
      alreadyCancelled: false,
    });
    await expect(
      service.receiveUploadPart(userId, uploadId, 1, file.subarray(4), sha256(file.subarray(4))),
    ).rejects.toMatchObject({ status: 409 });
    const upload = await pool.query('SELECT state FROM media_uploads WHERE id=$1', [uploadId]);
    expect(upload.rows[0].state).toBe('cancelled');
    const cleanup = await pool.query(
      `SELECT count(*)::int total FROM media_storage_deletions
       WHERE media_asset_id=$1 AND storage_key LIKE 'parts/%'`,
      [assetId],
    );
    expect(cleanup.rows[0].total).toBe(1);
  });
});
