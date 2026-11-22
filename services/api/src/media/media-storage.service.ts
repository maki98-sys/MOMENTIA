import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { lstat, mkdir, rename, rm, stat, writeFile, readFile } from 'fs/promises';
import { join, resolve } from 'path';

function s3EncryptionParams(): { ServerSideEncryption: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string } {
  const kmsKeyId = process.env.MEDIA_S3_SSE_KMS_KEY_ID?.trim();
  return kmsKeyId
    ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId }
    : { ServerSideEncryption: 'AES256' };
}

/** Reject existing symlinks before path-based filesystem operations. This is a
 * defense-in-depth preflight check, not an atomic openat/openat2 guarantee;
 * the media root must remain writable only by trusted service identities. */
async function assertNoSymlinkPath(root: string, target: string, createParents = false): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new ServiceUnavailableException('Media storage root must be a real directory.');
  }
  const relative = target.slice(root.length + 1);
  const segments = relative.split('/');
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const parent = index < segments.length - 1;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new ServiceUnavailableException('Symbolic links are not allowed in media storage.');
      if (parent && !info.isDirectory()) throw new ServiceUnavailableException('Media storage path parent is not a directory.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (createParents && parent) await mkdir(current, { mode: 0o700 });
    }
  }
}

/**
 * Storage boundary for original media and generated variants.
 * The API stores opaque keys in PostgreSQL; physical paths never leave this adapter.
 * A remote object-store implementation can replace this provider without changing
 * upload, authorization, quota, or processing orchestration.
 */
export abstract class MediaStorage {
  abstract put(storageKey: string, bytes: Buffer, provider?: string): Promise<void>;
  abstract remove(storageKey: string, provider?: string): Promise<void>;
  abstract locate(storageKey: string, expectedSize?: number, provider?: string): Promise<string>;
  abstract read(storageKey: string, provider?: string): Promise<Buffer>;
  abstract openReadStream(storageKey: string, expectedSize?: number, provider?: string): Promise<{ stream: Readable; sizeBytes: number }>;
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

  async put(storageKey: string, bytes: Buffer, _provider?: string): Promise<void> {
    const destination = this.pathFor(storageKey);
    const temporary = destination + '.' + randomUUID() + '.tmp';
    try {
      await assertNoSymlinkPath(this.root, destination, true);
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, destination);
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new ServiceUnavailableException('Media storage is unavailable.');
    }
  }

  async remove(storageKey: string, _provider?: string): Promise<void> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.root, target);
    await rm(target, { force: true });
  }

  async read(storageKey: string, _provider?: string): Promise<Buffer> {
    const target = await this.locate(storageKey);
    try { return await readFile(target); }
    catch { throw new ServiceUnavailableException('Media content is unavailable.'); }
  }

  async openReadStream(storageKey: string, expectedSize?: number, _provider?: string): Promise<{ stream: Readable; sizeBytes: number }> {
    const target = await this.locate(storageKey, expectedSize);
    const info = await stat(target);
    return { stream: createReadStream(target), sizeBytes: info.size };
  }

  async locate(storageKey: string, expectedSize?: number): Promise<string> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.root, target);
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
    if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') || storageKey.includes('\\') || storageKey.includes('\0')) {
      throw new ServiceUnavailableException('Invalid media storage key.');
    }
    return storageKey;
  }

  async put(storageKey: string, bytes: Buffer, _provider?: string): Promise<void> {
    try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey), Body: bytes, ...s3EncryptionParams() })); }
    catch { throw new ServiceUnavailableException('Remote media storage is unavailable.'); }
  }

  async remove(storageKey: string, _provider?: string): Promise<void> {
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) })); }
    catch { throw new ServiceUnavailableException('Remote media deletion failed.'); }
  }

  async read(storageKey: string, _provider?: string): Promise<Buffer> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
      if (!response.Body) throw new Error('Object body missing');
      return Buffer.from(await response.Body.transformToByteArray());
    } catch { throw new ServiceUnavailableException('Remote media content is unavailable.'); }
  }

  async openReadStream(storageKey: string, expectedSize?: number, _provider?: string): Promise<{ stream: Readable; sizeBytes: number }> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storageKey) }));
      if (!response.Body || response.ContentLength === undefined ||
          (expectedSize !== undefined && response.ContentLength !== expectedSize)) {
        throw new Error('Object size mismatch or body missing');
      }
      return { stream: Readable.from(response.Body as AsyncIterable<Uint8Array>), sizeBytes: response.ContentLength };
    } catch { throw new ServiceUnavailableException('Remote media content is unavailable.'); }
  }

  async locate(_storageKey: string, _expectedSize?: number, _provider?: string): Promise<string> {
    throw new ServiceUnavailableException('Remote objects do not have local filesystem paths.');
  }
}


@Injectable()
export class RoutedMediaStorage extends MediaStorage {
  constructor(private readonly local: LocalMediaStorage, private readonly remote: S3MediaStorage) { super(); }
  private select(provider?: string): MediaStorage {
    const selected = provider ?? process.env.MEDIA_STORAGE_PROVIDER ?? 'local';
    if (selected === 'local') return this.local;
    if (selected === 's3') return this.remote;
    throw new ServiceUnavailableException('Unknown media storage provider.');
  }
  put(key: string, bytes: Buffer, provider?: string) { return this.select(provider).put(key,bytes); }
  remove(key: string, provider?: string) { return this.select(provider).remove(key); }
  locate(key: string, size?: number, provider?: string) { return this.select(provider).locate(key,size); }
  read(key: string, provider?: string) { return this.select(provider).read(key); }
  openReadStream(key: string, size?: number, provider?: string) { return this.select(provider).openReadStream(key,size); }
}
