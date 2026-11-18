import {
  Injectable, Logger, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service';
import { S3CompatibleStorageService } from './s3-compatible-storage.service';

const MAX_PIXELS = 40_000_000;
const MAX_OUTPUT_BYTES = 25 * 1024 * 1024;
const LEASE_MINUTES = 10;
const POLL_INTERVAL_MS = 5_000;

type ClaimedJob = {
  id: string;
  media_asset_id: string;
  attempts: number;
  max_attempts: number;
};

type SourceAsset = {
  id: string;
  storage_key_original: string;
  size_bytes: string;
  status: string;
};

interface ProcessedVariant {
  type: 'thumbnail' | 'preview' | 'display';
  key: string;
  bytes: Buffer;
  width: number;
  height: number;
}

@Injectable()
export class MediaProcessingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediaProcessingWorker.name);
  private readonly workerId = randomUUID();
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopping = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly storage: S3CompatibleStorageService,
  ) {}

  onModuleInit(): void {
    if (!this.storage.isConfigured()) {
      this.logger.warn('Media worker is idle until private object storage is configured.');
      return;
    }
    this.schedule(1_000);
  }

  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      const job = await this.claimNextJob();
      if (job) await this.processJob(job);
    } catch (error) {
      this.logger.error('Media processing poll failed.', error instanceof Error ? error.stack : undefined);
    } finally {
      this.running = false;
      this.schedule(POLL_INTERVAL_MS);
    }
  }

  private async claimNextJob(): Promise<ClaimedJob | null> {
    await this.failExhaustedLeases();
    const result = await this.database.query<ClaimedJob>(
      `WITH candidate AS (
         SELECT id
         FROM media_processing_jobs
         WHERE (
           (status = 'queued' AND available_at <= now())
           OR (status = 'processing' AND locked_at < now() - ($2::int * interval '1 minute'))
         )
           AND attempts < max_attempts
         ORDER BY available_at, created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE media_processing_jobs AS job
       SET status = 'processing', attempts = job.attempts + 1,
           locked_at = now(), locked_by = $1, updated_at = now()
       FROM candidate
       WHERE job.id = candidate.id
       RETURNING job.id, job.media_asset_id, job.attempts, job.max_attempts`,
      [this.workerId, LEASE_MINUTES],
    );

    if (!result.rowCount) return null;

    const job = result.rows[0];
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE media_assets SET status = 'processing'
         WHERE id = $1 AND status IN ('pending','processing') AND deleted_at IS NULL`,
        [job.media_asset_id],
      );
      await client.query(
        `UPDATE media_uploads SET state = 'processing', updated_at = now()
         WHERE media_asset_id = $1 AND state IN ('uploaded','processing')`,
        [job.media_asset_id],
      );
    });
    return job;
  }

  private async failExhaustedLeases(): Promise<void> {
    await this.database.transaction(async (client) => {
      const expired = await client.query<{ media_asset_id: string }>(
        `UPDATE media_processing_jobs
         SET status = 'failed', locked_at = NULL, locked_by = NULL,
             last_error_code = 'RETRY_LIMIT_EXCEEDED', updated_at = now()
         WHERE status = 'processing'
           AND locked_at < now() - ($1::int * interval '1 minute')
           AND attempts >= max_attempts
         RETURNING media_asset_id`,
        [LEASE_MINUTES],
      );
      if (!expired.rowCount) return;
      const ids = expired.rows.map((row) => row.media_asset_id);
      await client.query(
        `UPDATE media_assets SET status = 'failed'
         WHERE id = ANY($1::uuid[]) AND status = 'processing'`,
        [ids],
      );
      await client.query(
        `UPDATE media_uploads SET state = 'failed', last_error_code = 'RETRY_LIMIT_EXCEEDED', updated_at = now()
         WHERE media_asset_id = ANY($1::uuid[]) AND state = 'processing'`,
        [ids],
      );
    });
  }

  private async processJob(job: ClaimedJob): Promise<void> {
    let originalKey: string | undefined;
    try {
      const result = await this.database.query<SourceAsset>(
        `SELECT id, storage_key_original, size_bytes, status
         FROM media_assets
         WHERE id = $1 AND status = 'processing' AND deleted_at IS NULL`,
        [job.media_asset_id],
      );
      if (!result.rowCount) throw new Error('ASSET_NOT_PROCESSABLE');
      const asset = result.rows[0];
      originalKey = asset.storage_key_original;
      const sourceBytes = await this.storage.getObjectBytes(originalKey, Number(asset.size_bytes));

      const input = sharp(sourceBytes, {
        failOn: 'error',
        limitInputPixels: MAX_PIXELS,
        sequentialRead: true,
        animated: false,
      });
      const metadata = await input.metadata();
      if (!metadata.width || !metadata.height || !metadata.format
        || !['jpeg', 'png', 'webp'].includes(metadata.format)
        || (metadata.pages ?? 1) !== 1
        || metadata.width * metadata.height > MAX_PIXELS) {
        throw new Error('IMAGE_DIMENSIONS_OR_FORMAT_REJECTED');
      }

      // Re-encode to WebP without withMetadata(): EXIF, GPS and source metadata are not copied.
      const master = await sharp(sourceBytes, {
        failOn: 'error',
        limitInputPixels: MAX_PIXELS,
        sequentialRead: true,
      })
        .rotate()
        .resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      if (master.data.length < 1 || master.data.length > MAX_OUTPUT_BYTES) {
        throw new Error('PROCESSED_IMAGE_SIZE_REJECTED');
      }

      const baseKey = `processed/${asset.id}`;
      const sanitizedOriginalKey = `${baseKey}/original.webp`;
      await this.storage.putObjectBytes(sanitizedOriginalKey, 'image/webp', master.data);

      const thumbnail = await sharp(master.data, { failOn: 'error', limitInputPixels: MAX_PIXELS })
        .resize({ width: 320, height: 320, fit: 'cover', withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const preview = await sharp(master.data, { failOn: 'error', limitInputPixels: MAX_PIXELS })
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer({ resolveWithObject: true });
      const display = await sharp(master.data, { failOn: 'error', limitInputPixels: MAX_PIXELS })
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85, effort: 4 })
        .toBuffer({ resolveWithObject: true });

      const variants: ProcessedVariant[] = [
        { type: 'thumbnail', key: `${baseKey}/thumbnail.webp`, bytes: thumbnail.data, width: thumbnail.info.width, height: thumbnail.info.height },
        { type: 'preview', key: `${baseKey}/preview.webp`, bytes: preview.data, width: preview.info.width, height: preview.info.height },
        { type: 'display', key: `${baseKey}/display.webp`, bytes: display.data, width: display.info.width, height: display.info.height },
      ];
      for (const variant of variants) {
        if (variant.bytes.length < 1 || variant.bytes.length > MAX_OUTPUT_BYTES) {
          throw new Error('DERIVATIVE_SIZE_REJECTED');
        }
        await this.storage.putObjectBytes(variant.key, 'image/webp', variant.bytes);
      }

      const checksum = createHash('sha256').update(master.data).digest('hex');
      await this.database.transaction(async (client) => {
        for (const variant of variants) {
          await client.query(
            `INSERT INTO media_variants
              (media_asset_id, variant_type, storage_key, mime_type, size_bytes, width, height)
             VALUES ($1, $2, $3, 'image/webp', $4, $5, $6)
             ON CONFLICT (media_asset_id, variant_type) DO UPDATE
             SET storage_key = EXCLUDED.storage_key, mime_type = EXCLUDED.mime_type,
                 size_bytes = EXCLUDED.size_bytes, width = EXCLUDED.width, height = EXCLUDED.height`,
            [asset.id, variant.type, variant.key, variant.bytes.length, variant.width, variant.height],
          );
        }
        await client.query(
          `UPDATE media_assets
           SET storage_key_original = $2, mime_type_detected = 'image/webp',
               size_bytes = $3, checksum_sha256 = $4,
               width = $5, height = $6, status = 'ready'
           WHERE id = $1 AND status = 'processing'`,
          [asset.id, sanitizedOriginalKey, master.data.length, checksum, master.info.width, master.info.height],
        );
        await client.query(
          `UPDATE media_uploads SET state = 'completed', updated_at = now()
           WHERE media_asset_id = $1 AND state = 'processing'`,
          [asset.id],
        );
        await client.query(
          `UPDATE media_processing_jobs
           SET status = 'completed', locked_at = NULL, locked_by = NULL,
               last_error_code = NULL, updated_at = now()
           WHERE id = $1 AND locked_by = $2 AND status = 'processing'`,
          [job.id, this.workerId],
        );
      });

      if (originalKey !== sanitizedOriginalKey) {
        try {
          await this.storage.deleteObject(originalKey);
        } catch {
          this.logger.warn(`Original private upload cleanup deferred for asset ${asset.id}.`);
        }
      }
      this.logger.log(`Media asset ${asset.id} processed with three sanitized variants.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN';
      const terminal = job.attempts >= job.max_attempts;
      await this.database.transaction(async (client) => {
        await client.query(
          `UPDATE media_processing_jobs
           SET status = $3, available_at = CASE WHEN $3 = 'queued'
             THEN now() + (LEAST(300, power(2, attempts)::int) * interval '1 second')
             ELSE available_at END,
             locked_at = NULL, locked_by = NULL,
             last_error_code = $4, updated_at = now()
           WHERE id = $1 AND locked_by = $2 AND status = 'processing'`,
          [job.id, this.workerId, terminal ? 'failed' : 'queued', safeErrorCode(message)],
        );
        await client.query(
          `UPDATE media_assets SET status = $2
           WHERE id = $1 AND status = 'processing'`,
          [job.media_asset_id, terminal ? 'failed' : 'pending'],
        );
        await client.query(
          `UPDATE media_uploads SET state = $2, last_error_code = $3, updated_at = now()
           WHERE media_asset_id = $1 AND state = 'processing'`,
          [job.media_asset_id, terminal ? 'failed' : 'uploaded', safeErrorCode(message)],
        );
      });
      this.logger.warn(`Media processing attempt failed for job ${job.id}: ${safeErrorCode(message)}`);
    }
  }
}

function safeErrorCode(message: string): string {
  return /^[A-Z0-9_]{1,64}$/.test(message) ? message : 'IMAGE_PROCESSING_FAILED';
}
