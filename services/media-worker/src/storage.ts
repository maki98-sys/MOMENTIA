import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export abstract class MediaWorkerStorage {
  abstract pathFor(storageKey: string): string;
  abstract ensureParent(storageKey: string): Promise<string>;
  abstract materialize(storageKey: string): Promise<string>;
  abstract commit(storageKey: string, localPath: string): Promise<void>;
  abstract remove(storageKey: string): Promise<void>;
  abstract stat(storageKey: string): Promise<{ size: number; isFile: boolean }>;
}

function validateKey(storageKey: string): void {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') ||
      storageKey.includes('\\') || storageKey.includes('\\0')) throw new Error('Unsafe storage key');
}

export class LocalMediaWorkerStorage extends MediaWorkerStorage {
  private readonly root = resolve(process.env.MEDIA_STORAGE_DIR ?? '/var/lib/momentia/media');
  pathFor(storageKey: string): string {
    validateKey(storageKey);
    const target = resolve(join(this.root, storageKey));
    if (!target.startsWith(this.root + '/')) throw new Error('Storage path escapes configured root');
    return target;
  }
  async ensureParent(storageKey: string): Promise<string> {
    const target = this.pathFor(storageKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    return target;
  }
  async materialize(storageKey: string): Promise<string> { return this.pathFor(storageKey); }
  async commit(_storageKey: string, _localPath: string): Promise<void> {}
  async remove(storageKey: string): Promise<void> { await rm(this.pathFor(storageKey), { force: true }); }
  async stat(storageKey: string): Promise<{ size: number; isFile: boolean }> {
    const info = await stat(this.pathFor(storageKey));
    return { size: info.size, isFile: info.isFile() };
  }
}

export class S3MediaWorkerStorage extends MediaWorkerStorage {
  private readonly bucket = process.env.MEDIA_S3_BUCKET!;
  private readonly stageRoot = resolve(process.env.MEDIA_WORKER_TEMP_DIR ?? '/tmp/momentia-media-worker');
  private readonly client = new S3Client({
    region: process.env.MEDIA_S3_REGION || 'us-east-1',
    endpoint: process.env.MEDIA_S3_ENDPOINT || undefined,
    forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.MEDIA_S3_ACCESS_KEY_ID && process.env.MEDIA_S3_SECRET_ACCESS_KEY
      ? { accessKeyId: process.env.MEDIA_S3_ACCESS_KEY_ID, secretAccessKey: process.env.MEDIA_S3_SECRET_ACCESS_KEY }
      : undefined,
  });
  pathFor(storageKey: string): string {
    validateKey(storageKey);
    const target = resolve(join(this.stageRoot, storageKey));
    if (!target.startsWith(this.stageRoot + '/')) throw new Error('Storage staging path escapes configured root');
    return target;
  }
  async ensureParent(storageKey: string): Promise<string> {
    const target = this.pathFor(storageKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    return target;
  }
  async materialize(storageKey: string): Promise<string> {
    const target = await this.ensureParent(storageKey);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (!response.Body) throw new Error('Remote object body is missing');
    await pipeline(Readable.from(response.Body as AsyncIterable<Uint8Array>), createWriteStream(target, { mode: 0o600 }));
    return target;
  }
  async commit(storageKey: string, localPath: string): Promise<void> {
    const info = await stat(localPath);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: storageKey, Body: createReadStream(localPath), ContentLength: info.size,
    }));
  }
  async remove(storageKey: string): Promise<void> {
    validateKey(storageKey);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    await rm(this.pathFor(storageKey), { force: true }).catch(() => undefined);
  }
  async stat(storageKey: string): Promise<{ size: number; isFile: boolean }> {
    validateKey(storageKey);
    const info = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    return { size: Number(info.ContentLength ?? 0), isFile: true };
  }
}

export function createMediaWorkerStorage(): MediaWorkerStorage {
  return process.env.MEDIA_STORAGE_PROVIDER === 's3'
    ? new S3MediaWorkerStorage()
    : new LocalMediaWorkerStorage();
}
