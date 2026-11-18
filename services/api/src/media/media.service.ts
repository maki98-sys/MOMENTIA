import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { S3CompatibleStorageService } from './s3-compatible-storage.service';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface CreateMediaUploadInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
}

@Injectable()
export class MediaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: S3CompatibleStorageService,
  ) {}

  async createUpload(userId: string, idempotencyKey: string, input: CreateMediaUploadInput) {
    validateInput(input);
    const existing = await this.database.query<{
      id: string; media_asset_id: string; size_bytes: string; checksum_sha256_declared: string;
      mime_type_declared: string; storage_key_original: string; state: string;
    }>(
      `SELECT u.id, u.media_asset_id, m.size_bytes, m.checksum_sha256_declared,
              u.state, m.mime_type_declared, m.storage_key_original
       FROM media_uploads u JOIN media_assets m ON m.id = u.media_asset_id
       WHERE u.uploader_id = $1 AND u.idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (Number(row.size_bytes) !== input.sizeBytes
        || row.checksum_sha256_declared.trim() !== input.checksumSha256
        || row.mime_type_declared !== input.contentType) {
        throw new ConflictException('Idempotency key was already used with different upload metadata.');
      }
      if (row.state !== 'created' && row.state !== 'uploading') {
        return { uploadId: row.id, mediaAssetId: row.media_asset_id, state: row.state };
      }
      const uploadUrl = await this.storage.presignPut(row.storage_key_original, input.contentType, 600);
      return {
        uploadId: row.id, mediaAssetId: row.media_asset_id, state: row.state,
        uploadUrl, method: 'PUT', requiredHeaders: { 'Content-Type': input.contentType },
        expiresInSeconds: 600,
      };
    }

    const mediaAssetId = randomUUID();
    const uploadId = randomUUID();
    const storageKey = `original/${userId}/${mediaAssetId}`;
    const uploadUrl = await this.storage.presignPut(storageKey, input.contentType, 600);
    await this.database.transaction(async (client) => {
      await client.query(
        `INSERT INTO media_assets
          (id, owner_id, storage_key_original, mime_type_detected, mime_type_declared,
           size_bytes, checksum_sha256, checksum_sha256_declared, status)
         VALUES ($1, $2, $3, 'application/octet-stream', $4, $5, $6, $7, 'pending')`,
        [mediaAssetId, userId, storageKey, input.contentType, input.sizeBytes, '0'.repeat(64), input.checksumSha256],
      );
      await client.query(
        `INSERT INTO media_uploads
          (id, media_asset_id, uploader_id, state, idempotency_key)
         VALUES ($1, $2, $3, 'created', $4)`,
        [uploadId, mediaAssetId, userId, idempotencyKey],
      );
    });
    return {
      uploadId, mediaAssetId, state: 'created', uploadUrl, method: 'PUT',
      requiredHeaders: { 'Content-Type': input.contentType }, expiresInSeconds: 600,
    };
  }

  async completeUpload(userId: string, uploadId: string) {
    const result = await this.database.query<{
      upload_id: string; media_asset_id: string; state: string; storage_key_original: string;
      size_bytes: string; mime_type_declared: string; checksum_sha256_declared: string;
    }>(
      `SELECT u.id AS upload_id, u.media_asset_id, u.state, m.storage_key_original,
              m.size_bytes, m.mime_type_declared, m.checksum_sha256_declared
       FROM media_uploads u JOIN media_assets m ON m.id = u.media_asset_id
       WHERE u.id = $1 AND u.uploader_id = $2 AND m.owner_id = $2 AND m.deleted_at IS NULL`,
      [uploadId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Upload not found.');
    const row = result.rows[0];
    if (row.state === 'uploaded' || row.state === 'processing' || row.state === 'completed') {
      return { uploadId, mediaAssetId: row.media_asset_id, state: row.state };
    }
    if (row.state !== 'created' && row.state !== 'uploading') {
      throw new ConflictException('Upload is not in a completable state.');
    }

    const object = await this.storage.headObject(row.storage_key_original);
    if (object.size !== Number(row.size_bytes)) {
      throw new ConflictException('Uploaded file size does not match the declared size.');
    }
    if (!object.contentType || object.contentType.split(';')[0].trim().toLowerCase() !== row.mime_type_declared) {
      throw new ConflictException('Uploaded file content type does not match the declared type.');
    }

    const bytes = await this.storage.getObjectBytes(row.storage_key_original, object.size);
    const detectedMime = detectImageMime(bytes);
    const actualChecksum = createHash('sha256').update(bytes).digest('hex');
    if (detectedMime !== row.mime_type_declared || actualChecksum !== row.checksum_sha256_declared.trim()) {
      await this.database.transaction(async (client) => {
        await client.query(
          `UPDATE media_assets SET status = 'quarantined' WHERE id = $1 AND owner_id = $2 AND status = 'pending'`,
          [row.media_asset_id, userId],
        );
        await client.query(
          `UPDATE media_uploads SET state = 'failed', last_error_code = 'CONTENT_VALIDATION_FAILED', updated_at = now()
           WHERE id = $1 AND uploader_id = $2 AND state IN ('created','uploading')`,
          [uploadId, userId],
        );
      });
      throw new ConflictException('Image content does not match its declared MIME type or SHA-256 checksum; asset quarantined.');
    }

    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE media_uploads SET state = 'uploaded', bytes_received = $2, updated_at = now()
         WHERE id = $1 AND uploader_id = $3 AND state IN ('created','uploading')`,
        [uploadId, object.size, userId],
      );
      await client.query(
        `UPDATE media_assets SET mime_type_detected = $2, checksum_sha256 = $3
         WHERE id = $1 AND owner_id = $4 AND status = 'pending'`,
        [row.media_asset_id, detectedMime, actualChecksum, userId],
      );
      await client.query(
        `INSERT INTO media_processing_jobs (media_asset_id, status, available_at)
         VALUES ($1, 'queued', now())
         ON CONFLICT (media_asset_id) DO NOTHING`,
        [row.media_asset_id],
      );
    });
    return {
      uploadId, mediaAssetId: row.media_asset_id, state: 'uploaded',
      processing: 'pending', verified: true,
      message: 'File size, image signature and SHA-256 verified; a durable processing job has been queued for decoding, metadata removal and derivatives.',
    };
  }

  async getVariantUrl(userId: string, mediaAssetId: string, variant: 'original' | 'thumbnail' | 'preview' | 'display') {
    const result = await this.database.query<{ storage_key: string }>(
      `SELECT CASE WHEN $3 = 'original' THEN m.storage_key_original ELSE v.storage_key END AS storage_key
       FROM media_assets m
       LEFT JOIN media_variants v
         ON v.media_asset_id = m.id AND v.variant_type = $3
       WHERE m.id = $1 AND m.status = 'ready' AND m.deleted_at IS NULL
         AND ($3 = 'original' OR v.storage_key IS NOT NULL)
         AND (
           m.owner_id = $2
           OR EXISTS (
             SELECT 1 FROM media_access_grants g
             WHERE g.media_asset_id = m.id AND g.subject_type = 'user'
               AND g.subject_id = $2 AND g.permission IN ('view','download')
               AND (g.expires_at IS NULL OR g.expires_at > now())
           )
           OR EXISTS (
             SELECT 1 FROM media_access_grants g
             JOIN space_memberships sm ON sm.space_id = g.subject_id
             WHERE g.media_asset_id = m.id AND g.subject_type = 'space'
               AND g.permission IN ('view','download')
               AND (g.expires_at IS NULL OR g.expires_at > now())
               AND sm.user_id = $2 AND sm.state = 'active'
           )
           OR EXISTS (
             SELECT 1
             FROM event_album_items i
             JOIN event_albums a ON a.id = i.album_id
             JOIN spaces s ON s.id = a.space_id AND s.status = 'active'
             JOIN space_memberships sm ON sm.space_id = s.id
             WHERE i.media_asset_id = m.id AND sm.user_id = $2 AND sm.state = 'active'
           )
           OR EXISTS (
             SELECT 1 FROM posts p
             WHERE p.media_asset_id = m.id AND p.status = 'published'
               AND (
                 p.author_id = $2
                 OR p.audience = 'public'
                 OR (p.audience = 'followers' AND EXISTS (
                   SELECT 1 FROM user_relationships r
                   WHERE r.state = 'accepted'
                     AND ((r.requester_id = $2 AND r.target_id = p.author_id)
                       OR (r.requester_id = p.author_id AND r.target_id = $2))
                 ))
                 OR (p.audience = 'space' AND EXISTS (
                   SELECT 1 FROM space_memberships sm
                   WHERE sm.space_id = p.space_id AND sm.user_id = $2 AND sm.state = 'active'
                 ))
               )
               AND NOT EXISTS (
                 SELECT 1 FROM user_blocks b
                 WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
                    OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
               )
           )
         )
       LIMIT 1`,
      [mediaAssetId, userId, variant],
    );
    if (!result.rowCount) throw new NotFoundException('Media asset or authorized variant not found.');
    const url = await this.storage.presignGet(result.rows[0].storage_key, 60);
    return { mediaAssetId, variant, url, expiresInSeconds: 60 };
  }
}

function detectImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function validateInput(input: CreateMediaUploadInput): void {
  if (!input.fileName.trim() || input.fileName.length > 180
    || input.fileName.includes('/') || input.fileName.includes('\\')) {
    throw new BadRequestException('fileName must be a simple file name of at most 180 characters.');
  }
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new BadRequestException('Only JPEG, PNG and WebP images are accepted in this upload phase.');
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Image size must be between 1 byte and 25 MB.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
    throw new BadRequestException('checksumSha256 must be a lowercase SHA-256 hex digest.');
  }
}
