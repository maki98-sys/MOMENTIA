import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
      id: string; media_asset_id: string; size_bytes: string; checksum_sha256: string;
      mime_type_detected: string; storage_key_original: string; state: string;
    }>(
      `SELECT u.id, u.media_asset_id, m.size_bytes, m.checksum_sha256,
              u.state, m.mime_type_detected, m.storage_key_original
       FROM media_uploads u JOIN media_assets m ON m.id = u.media_asset_id
       WHERE u.uploader_id = $1 AND u.idempotency_key = $2`,
      [userId, idempotencyKey],
    );
    if (existing.rowCount) {
      const row = existing.rows[0];
      if (Number(row.size_bytes) !== input.sizeBytes
        || row.checksum_sha256.trim() !== input.checksumSha256
        || row.mime_type_detected !== input.contentType) {
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
          (id, owner_id, storage_key_original, mime_type_detected, size_bytes, checksum_sha256, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
        [mediaAssetId, userId, storageKey, input.contentType, input.sizeBytes, input.checksumSha256],
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
      size_bytes: string; mime_type_detected: string;
    }>(
      `SELECT u.id AS upload_id, u.media_asset_id, u.state, m.storage_key_original,
              m.size_bytes, m.mime_type_detected
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
    if (object.contentType && object.contentType.split(';')[0].trim().toLowerCase() !== row.mime_type_detected) {
      throw new ConflictException('Uploaded file content type does not match the declared type.');
    }
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE media_uploads SET state = 'uploaded', bytes_received = $2, updated_at = now()
         WHERE id = $1 AND uploader_id = $3 AND state IN ('created','uploading')`,
        [uploadId, object.size, userId],
      );
      await client.query(
        `UPDATE media_assets SET status = 'pending' WHERE id = $1 AND owner_id = $2 AND status = 'pending'`,
        [row.media_asset_id, userId],
      );
    });
    return {
      uploadId, mediaAssetId: row.media_asset_id, state: 'uploaded',
      processing: 'pending', message: 'File received; image validation and derivative processing are not yet implemented.',
    };
  }
}

function validateInput(input: CreateMediaUploadInput): void {
  if (!input.fileName.trim() || input.fileName.length > 180
    || input.fileName.includes('/') || input.fileName.includes('\\')) {
    throw new BadRequestException('fileName must be a simple file name of at most 180 characters.');
  }
  if (!ALLOWED_TYPES.has(input.contentType.toLowerCase())) {
    throw new BadRequestException('Only JPEG, PNG and WebP images are accepted in this upload phase.');
  }
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Image size must be between 1 byte and 25 MB.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256)) {
    throw new BadRequestException('checksumSha256 must be a lowercase SHA-256 hex digest.');
  }
}
