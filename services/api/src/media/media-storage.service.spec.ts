import { ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalMediaStorage, S3MediaStorage } from './media-storage.service';

describe('LocalMediaStorage symlink path hardening', () => {
  let root: string;
  let previousRoot: string | undefined;
  let storage: LocalMediaStorage;

  beforeEach(async () => {
    previousRoot = process.env.MEDIA_STORAGE_DIR;
    root = await mkdtemp(join(tmpdir(), 'momentia-api-media-'));
    process.env.MEDIA_STORAGE_DIR = root;
    storage = new LocalMediaStorage();
  });

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env.MEDIA_STORAGE_DIR;
    else process.env.MEDIA_STORAGE_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  });

  it('supports put, read, locate, stream and remove for regular files', async () => {
    const payload = Buffer.from('momentia-media');
    await storage.put('users/u1/photo.bin', payload);
    expect(await storage.read('users/u1/photo.bin')).toEqual(payload);
    expect(await storage.locate('users/u1/photo.bin', payload.length)).toContain('users/u1/photo.bin');
    const opened = await storage.openReadStream('users/u1/photo.bin', payload.length);
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(payload);
    await storage.remove('users/u1/photo.bin');
    await expect(readFile(join(root, 'users/u1/photo.bin'))).rejects.toBeDefined();
  });

  it('streams a staged file into local storage without constructing a media Buffer', async () => {
    const source = join(root, 'staged-upload.bin');
    const payload = Buffer.from('streamed-media-content');
    await writeFile(source, payload);
    await storage.putFile('users/u1/streamed.bin', source, payload.length, createHash('sha256').update(payload).digest('hex'));
    expect(await readFile(join(root, 'users/u1/streamed.bin'))).toEqual(payload);
  });

  it('does not publish a local staged object when its checksum differs', async () => {
    const source = join(root, 'bad-staged-upload.bin');
    const payload = Buffer.from('tampered-media');
    await writeFile(source, payload);
    await expect(storage.putFile('users/u1/tampered.bin', source, payload.length, '0'.repeat(64)))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(readFile(join(root, 'users/u1/tampered.bin'))).rejects.toBeDefined();
  });

  it('rejects symlinked parent directories before writes', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'momentia-api-outside-'));
    try {
      await symlink(outside, join(root, 'escape'), 'dir');
      await expect(storage.put('escape/payload.bin', Buffer.from('secret')))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(readFile(join(outside, 'payload.bin'))).rejects.toBeDefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects symlinked files for read, locate, stream and remove', async () => {
    const outside = join(root, '..', 'momentia-api-secret-' + Date.now());
    await writeFile(outside, 'secret');
    try {
      await symlink(outside, join(root, 'secret-link.bin'));
      await expect(storage.read('secret-link.bin')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(storage.locate('secret-link.bin')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(storage.openReadStream('secret-link.bin')).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(storage.remove('secret-link.bin')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(await readFile(outside, 'utf8')).toBe('secret');
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('rejects a symlink used as the configured storage root', async () => {
    const realRoot = await mkdtemp(join(tmpdir(), 'momentia-api-real-root-'));
    const linkRoot = root + '-link';
    await symlink(realRoot, linkRoot, 'dir');
    process.env.MEDIA_STORAGE_DIR = linkRoot;
    try {
      const linkedStorage = new LocalMediaStorage();
      await expect(linkedStorage.put('photo.bin', Buffer.from('x')))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      await rm(linkRoot, { force: true });
      await rm(realRoot, { recursive: true, force: true });
    }
  });
});


describe('S3MediaStorage server-side encryption', () => {
  const originalBucket = process.env.MEDIA_S3_BUCKET;
  const originalKmsKey = process.env.MEDIA_S3_SSE_KMS_KEY_ID;
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.MEDIA_S3_BUCKET = 'momentia-test';
    delete process.env.MEDIA_S3_SSE_KMS_KEY_ID;
    sendSpy = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
  });

  afterEach(() => {
    sendSpy.mockRestore();
    if (originalBucket === undefined) delete process.env.MEDIA_S3_BUCKET;
    else process.env.MEDIA_S3_BUCKET = originalBucket;
    if (originalKmsKey === undefined) delete process.env.MEDIA_S3_SSE_KMS_KEY_ID;
    else process.env.MEDIA_S3_SSE_KMS_KEY_ID = originalKmsKey;
  });

  it('uses SSE-S3 by default for every object upload', async () => {
    const storage = new S3MediaStorage();
    await storage.put('users/u1/photo.bin', Buffer.from('photo'));
    const command = sendSpy.mock.calls[0][0] as PutObjectCommand;
    expect(command.input.ServerSideEncryption).toBe('AES256');
  });

  it('streams staged files to S3 with a fixed content length and server-side encryption', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'momentia-s3-staged-'));
    const source = join(stage, 'upload.bin');
    const payload = Buffer.from('streamed-s3-content');
    await writeFile(source, payload);
    try {
      const checksum = createHash('sha256').update(payload).digest('hex');
      const checksumBase64 = Buffer.from(checksum, 'hex').toString('base64');
      sendSpy.mockImplementation(async (command: any) => {
        if (command instanceof PutObjectCommand) {
          for await (const _chunk of command.input.Body) { /* consume upload stream */ }
          return {} as never;
        }
        if (command instanceof HeadObjectCommand) {
          return { ContentLength: payload.length, ChecksumSHA256: checksumBase64 } as never;
        }
        return {} as never;
      });
      const storage = new S3MediaStorage();
      await storage.putFile('users/u1/streamed.bin', source, payload.length, checksum);
      const command = sendSpy.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.ContentLength).toBe(payload.length);
      expect(command.input.ChecksumSHA256).toBe(checksumBase64);
      expect(command.input.Body).toBeDefined();
      expect(command.input.ServerSideEncryption).toBe('AES256');
      expect(sendSpy.mock.calls[1][0]).toBeInstanceOf(HeadObjectCommand);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });

  it('does not delete an existing S3 key when pre-upload checksum validation fails', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'momentia-s3-invalid-checksum-'));
    const source = join(stage, 'upload.bin');
    await writeFile(source, Buffer.from('payload'));
    try {
      const storage = new S3MediaStorage();
      await expect(storage.putFile('users/u1/existing.bin', source, 7, 'invalid-checksum'))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sendSpy).not.toHaveBeenCalled();
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });

  it('deletes an S3 object when its post-upload checksum does not match', async () => {
    const stage = await mkdtemp(join(tmpdir(), 'momentia-s3-checksum-mismatch-'));
    const source = join(stage, 'upload.bin');
    const payload = Buffer.from('streamed-s3-content');
    await writeFile(source, payload);
    sendSpy.mockImplementation(async (command: any) => {
      if (command instanceof PutObjectCommand) {
        for await (const _chunk of command.input.Body) { /* consume upload stream */ }
        return {} as never;
      }
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: payload.length, ChecksumSHA256: 'mismatched' } as never;
      }
      return {} as never;
    });
    try {
      const storage = new S3MediaStorage();
      const checksum = createHash('sha256').update(payload).digest('hex');
      await expect(storage.putFile('users/u1/mismatch.bin', source, payload.length, checksum))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(sendSpy.mock.calls.some(([command]) => command instanceof DeleteObjectCommand)).toBe(true);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });

  it('uses the configured customer-managed KMS key when provided', async () => {
    process.env.MEDIA_S3_SSE_KMS_KEY_ID = 'arn:aws:kms:us-east-1:123456789012:key/momentia';
    const storage = new S3MediaStorage();
    await storage.put('users/u1/photo.bin', Buffer.from('photo'));
    const command = sendSpy.mock.calls[0][0] as PutObjectCommand;
    expect(command.input.ServerSideEncryption).toBe('aws:kms');
    expect(command.input.SSEKMSKeyId).toBe(process.env.MEDIA_S3_SSE_KMS_KEY_ID);
  });
});
