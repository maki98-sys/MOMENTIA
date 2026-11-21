import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, rename, rm, stat, writeFile, readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

/**
 * Storage boundary for original media and generated variants.
 * The API stores opaque keys in PostgreSQL; physical paths never leave this adapter.
 * A remote object-store implementation can replace this provider without changing
 * upload, authorization, quota, or processing orchestration.
 */
export abstract class MediaStorage {
  abstract put(storageKey: string, bytes: Buffer): Promise<void>;
  abstract remove(storageKey: string): Promise<void>;
  abstract locate(storageKey: string, expectedSize?: number): Promise<string>;
  abstract read(storageKey: string): Promise<Buffer>;
  abstract openReadStream(storageKey: string, expectedSize?: number): Promise<{ stream: Readable; sizeBytes: number }>;
}

@Injectable()
export class LocalMediaStorage extends MediaStorage {
  private readonly root = resolve(process.env.MEDIA_STORAGE_DIR || '/var/lib/momentia/media');

  private pathFor(storageKey: string): string {
    if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') || storageKey.includes('\\') || storageKey.includes('\0')) {
      throw new ServiceUnavailableException('Invalid media storage key.');
    }
    const target = resolve(join(this.root, storageKey));
    if (!target.startsWith(this.root + '/') ) throw new ServiceUnavailableException('Invalid media storage destination.');
    return target;
  }

  async put(storageKey: string, bytes: Buffer): Promise<void> {
    const destination = this.pathFor(storageKey);
    const temporary = destination + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new ServiceUnavailableException('Media storage is unavailable.');
    }
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  async read(storageKey: string): Promise<Buffer> {
    const target = await this.locate(storageKey);
    try { return await readFile(target); }
    catch { throw new ServiceUnavailableException('Media content is unavailable.'); }
  }

  async openReadStream(storageKey: string, expectedSize?: number): Promise<{ stream: ReadStream; sizeBytes: number }> {
    const target = await this.locate(storageKey, expectedSize);
    const info = await stat(target);
    return { stream: createReadStream(target), sizeBytes: info.size };
  }

  async locate(storageKey: string, expectedSize?: number): Promise<string> {
    const target = this.pathFor(storageKey);
    const info = await stat(target).catch(() => null);
    if (!info || !info.isFile() || (expectedSize !== undefined && info.size !== expectedSize)) {
      throw new ServiceUnavailableException('Media content is unavailable.');
    }
    return target;
  }
}


@Injectable()
export class S3MediaStorage extends MediaStorage {
  private readonly bucket = process.env.MEDIA_S3_BUCKET!;
  private readonly client = new S3Client({
    region: process.env.MEDIA_S3_REGION || 'us-east-1',
    endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.MEDIA_S3_ACCESS_KEY_ID && process.env.MEDIA_S3_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY }
      : undefined,
  });

  private key(storageKey: string): string {
    if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') || storageKey.includes('\\\\') || storageKey.includes('\\0')) {
      throw new ServiceUnavailableException('Invalid media storage key.');
    }
    return storageKey;
  }

  async put(storageKey: string, bytes: Buffer): Promise<void> {
    try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey), Body: bytes })); }
    catch { throw new ServiceUnavailableException('Remote media storage is unavailable.'); }
  }

  async remove(storageKey: string): Promise<void> {
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) })); }
    catch { throw new ServiceUnavailableException('Remote media deletion failed.'); }
  }

  async read(storageKey: string): Promise<Buffer> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
      if (!response.Body) throw new Error('Object body missing');
      return Buffer.from(await response.Body.transformToByteArray());
    } catch { throw new ServiceUnavailableException('Remote media content is unavailable.'); }
  }

  async openReadStream(storageKey: string, expectedSize?: number): Promise<{ stream: Readable; sizeBytes: number }> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
      if (!response.Body || response.ContentLength === undefined ||
          (expectedSize !== undefined && response.ContentLength !== expectedSize)) {
        throw new Error('Object size mismatch or body missing');
      }
      return { stream: Readable.from(response.Body as AsyncIterable<Uint8Array>), sizeBytes: response.ContentLength };
    } catch { throw new ServiceUnavailableException('Remote media content is unavailable.'); }
  }

  async locate(_storageKey: string, _expectedSize?: number): Promise<string> {
    throw new ServiceUnavailableException('Remote objects do not have local filesystem paths.');
  }
}
