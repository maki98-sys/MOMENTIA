import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { MediaService } from '../src/media/media.service';
import { MediaStorage } from '../src/media/media-storage.service';

describe('Media asset cross-account privacy PostgreSQL E2E', () => {
  let pool: Pool;
  let service: MediaService;
  let ownerId = '';
  let viewerId = '';
  let assetId = '';

  const storage = {} as MediaStorage;

  async function seedPrivateReadyAsset() {
    ownerId = randomUUID();
    viewerId = randomUUID();
    assetId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active')`,
      [ownerId, `media-owner-${ownerId}@momentia.test`, viewerId, `media-viewer-${viewerId}@momentia.test`],
    );
    await pool.query(
      `INSERT INTO media_assets(
         id,owner_id,storage_key_original,storage_provider,original_filename,
         mime_type_detected,size_bytes,checksum_sha256,status
       ) VALUES($1,$2,$3,'local','private.jpg','image/jpeg',128,$4,'ready')`,
      [assetId, ownerId, `pending/${ownerId}/${assetId}`, 'a'.repeat(64)],
    );
  }

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for media privacy E2E tests.');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    service = new MediaService(new DatabaseService(pool), storage);
  });

  afterEach(async () => {
    if (!ownerId) return;
    await pool.query('DELETE FROM media_assets WHERE id=$1', [assetId]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ownerId, viewerId]]);
    ownerId = '';
    viewerId = '';
    assetId = '';
  });

  afterAll(async () => { await pool?.end(); });

  it('allows the active owner to resolve their original asset metadata', async () => {
    await seedPrivateReadyAsset();

    await expect(service.getAssetContent(ownerId, assetId)).resolves.toMatchObject({
      storageKey: `pending/${ownerId}/${assetId}`,
      mimeType: 'image/jpeg',
      filename: 'private.jpg',
      sizeBytes: 128,
      storageProvider: 'local',
    });
  });

  it('does not expose a private asset to a different active account', async () => {
    await seedPrivateReadyAsset();

    await expect(service.getAssetContent(viewerId, assetId)).rejects.toMatchObject({ status: 404 });
  });

  it('does not allow a suspended owner to retrieve their previously ready asset', async () => {
    await seedPrivateReadyAsset();
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [ownerId]);

    await expect(service.getAssetContent(ownerId, assetId)).rejects.toMatchObject({ status: 404 });
  });

  it('does not allow a suspended viewer to resolve another account media', async () => {
    await seedPrivateReadyAsset();
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [viewerId]);

    await expect(service.getAssetContent(viewerId, assetId)).rejects.toMatchObject({ status: 404 });
  });
});
