import { createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function s3EncryptionParams(): { ServerSideEncryption: 'AES256' | 'aws:kms'; SSEKMSKeyId?: string } {
  const kmsKeyId = process.env.MEDIA_S3_SSE_KMS_KEY_ID?.trim();
  return kmsKeyId
    ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId }
    : { ServerSideEncryption: 'AES256' };
}

const MAX_MEDIA_OBJECT_BYTES = 200 * 1024 * 1024;

export abstract class MediaWorkerStorage {
  abstract pathFor(storageKey: string): string;
  abstract ensureParent(storageKey: string): Promise<string>;
  abstract materialize(storageKey: string, expectedSize?: number): Promise<string>;
  abstract commit(storageKey: string, localPath: string, checksumSha256?: string): Promise<void>;
  abstract release(storageKey: string): Promise<void>;
  abstract remove(storageKey: string): Promise<void>;
  abstract stat(storageKey: string): Promise<{ size: number; isFile: boolean }>;
}

async function assertNoSymlinkPath(root: string, target: string, createParents = false): Promise<void> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Storage root must be a real directory');
  const relative = target.slice(root.length + 1);
  const segments = relative.split('/');
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]);
    const isParent = index < segments.length - 1;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error('Symbolic links are not allowed in storage paths');
      if (isParent && !info.isDirectory()) throw new Error('Storage path parent must be a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (createParents && isParent) await mkdir(current, { mode: 0o700 });
    }
  }
}

function validateKey(storageKey: string): void {
  if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') ||
      storageKey.includes('\\') || storageKey.includes('\0')) throw new Error('Unsafe storage key');
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
    await assertNoSymlinkPath(this.root, target, true);
    return target;
  }
  async materialize(storageKey: string, expectedSize?: number): Promise<string> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.root, target);
    const info = await stat(target);
    if (info.size > MAX_MEDIA_OBJECT_BYTES) throw new Error('Stored media object exceeds the worker size limit');
    if (expectedSize !== undefined && info.size !== expectedSize) throw new Error('Stored media object size differs from the declared size');
    return target;
  }
  async commit(storageKey: string, localPath: string, checksumSha256?: string): Promise<void> {
    validateKey(storageKey);
    if (!checksumSha256 || !/^[a-f0-9]{64}$/i.test(checksumSha256)) {
      throw new Error('A SHA-256 checksum is required before committing a media object');
    }
    const target = this.pathFor(storageKey);
    const source = resolve(localPath);
    if (!source.startsWith(this.root + '/')) throw new Error('Local media staging path escapes configured root');
    await assertNoSymlinkPath(this.root, source);
    await assertNoSymlinkPath(this.root, target, true);
    const info = await stat(source);
    if (!info.isFile()) throw new Error('Media staging path must be a regular file');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(source)) hash.update(chunk as Buffer);
    if (hash.digest('hex') !== checksumSha256.toLowerCase()) {
      throw new Error('Staged media object failed SHA-256 verification');
    }
    if (source !== target) await rename(source, target);
  }
  async release(_storageKey: string): Promise<void> {}
  async remove(storageKey: string): Promise<void> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.root, target);
    await rm(target, { force: true });
  }
  async stat(storageKey: string): Promise<{ size: number; isFile: boolean }> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.root, target);
    const info = await stat(target);
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
    await assertNoSymlinkPath(this.stageRoot, target, true);
    return target;
  }
  async materialize(storageKey: string, expectedSize?: number): Promise<string> {
    const target = await this.ensureParent(storageKey);
    if (expectedSize !== undefined &&
        (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_MEDIA_OBJECT_BYTES)) {
      throw new Error('Declared media object size is outside the worker limit');
    }
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    const contentLength = Number(head.ContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_MEDIA_OBJECT_BYTES) {
      throw new Error('Remote media object size is outside the worker limit');
    }
    if (expectedSize !== undefined && contentLength !== expectedSize) {
      throw new Error('Remote media object size differs from the declared size');
    }
    // Remove an abandoned staging file from a prior crashed attempt before
    // opening a new exclusive destination.
    await rm(target, { force: true });
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    if (!response.Body) throw new Error('Remote object body is missing');
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer | Uint8Array, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_MEDIA_OBJECT_BYTES ||
            (expectedSize !== undefined && received > expectedSize)) {
          callback(new Error('Remote media stream exceeded its declared size or worker limit'));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.from(response.Body as AsyncIterable<Uint8Array>),
        limiter,
        createWriteStream(target, { flags: 'wx', mode: 0o600 }),
      );
      if (received !== contentLength || (expectedSize !== undefined && received !== expectedSize)) {
        throw new Error('Downloaded media object size does not match its HEAD metadata');
      }
      return target;
    } catch (error) {
      await rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  async commit(storageKey: string, localPath: string, checksumSha256?: string): Promise<void> {
    validateKey(storageKey);
    if (!checksumSha256 || !/^[a-f0-9]{64}$/i.test(checksumSha256)) {
      throw new Error('A SHA-256 checksum is required before committing a media object');
    }
    const info = await stat(localPath);
    const expectedChecksum = Buffer.from(checksumSha256, 'hex').toString('base64');
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: storageKey, Body: createReadStream(localPath), ContentLength: info.size,
      ChecksumSHA256: expectedChecksum,
      ...s3EncryptionParams(),
    }));
    try {
      const stored = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket, Key: storageKey, ChecksumMode: 'ENABLED',
      }));
      if (Number(stored.ContentLength) !== info.size || stored.ChecksumSHA256 !== expectedChecksum) {
        throw new Error('Uploaded media object failed size or SHA-256 verification');
      }
    } catch (error) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey })).catch(() => undefined);
      throw error;
    }
  }
  async release(storageKey: string): Promise<void> {
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.stageRoot, target);
    await rm(target, { force: true });
  }
  async remove(storageKey: string): Promise<void> {
    validateKey(storageKey);
    const target = this.pathFor(storageKey);
    await assertNoSymlinkPath(this.stageRoot, target);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    await rm(target, { force: true }).catch(() => undefined);
  }
  async stat(storageKey: string): Promise<{ size: number; isFile: boolean }> {
    validateKey(storageKey);
    const info = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: storageKey }));
    return { size: Number(info.ContentLength ?? 0), isFile: true };
  }
}

export function createMediaWorkerStorage(provider = process.env.MEDIA_STORAGE_PROVIDER ?? 'local'): MediaWorkerStorage {
  if (provider === 's3') {
    if (!process.env.MEDIA_S3_BUCKET) throw new Error('MEDIA_S3_BUCKET is required when MEDIA_STORAGE_PROVIDER=s3');
    if (Boolean(process.env.MEDIA_S3_ACCESS_KEY_ID) !== Boolean(process.env.MEDIA_S3_SECRET_ACCESS_KEY)) {
      throw new Error('Both S3 access key and secret key must be configured together');
    }
    return new S3MediaWorkerStorage();
  }
  if (provider !== 'local') throw new Error('Unsupported media storage provider');
  return new LocalMediaWorkerStorage();
}
