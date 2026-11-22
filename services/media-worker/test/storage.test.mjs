import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  createMediaWorkerStorage,
  LocalMediaWorkerStorage,
  S3MediaWorkerStorage,
} from '../dist/storage.js';

const envKeys = [
  'MEDIA_STORAGE_PROVIDER',
  'MEDIA_STORAGE_DIR',
  'MEDIA_WORKER_TEMP_DIR',
  'MEDIA_S3_BUCKET',
  'MEDIA_S3_ACCESS_KEY_ID',
  'MEDIA_S3_SECRET_ACCESS_KEY',
  'MEDIA_S3_REGION',
  'MEDIA_S3_ENDPOINT',
  'MEDIA_S3_FORCE_PATH_STYLE',
  'MEDIA_S3_SSE_KMS_KEY_ID',
];

async function withCleanEnv(fn) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  for (const key of envKeys) delete process.env[key];
  try {
    await fn();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('local provider validates keys and confines filesystem operations to its root', async () => {
  await withCleanEnv(async () => {
    const root = await mkdtemp(join(tmpdir(), 'momentia-local-storage-'));
    process.env.MEDIA_STORAGE_DIR = root;
    try {
      const storage = new LocalMediaWorkerStorage();
      assert.throws(() => storage.pathFor('../outside'), /Unsafe storage key/);
      assert.throws(() => storage.pathFor('/absolute'), /Unsafe storage key/);
      assert.throws(() => storage.pathFor('folder\\file'), /Unsafe storage key/);
      assert.throws(() => storage.pathFor('folder/../../outside'), /Unsafe storage key/);

      const target = await storage.ensureParent('users/u1/photo.bin');
      await writeFile(target, Buffer.from('momentia'));
      assert.deepEqual(await storage.stat('users/u1/photo.bin'), { size: 8, isFile: true });
      assert.equal(await readFile(target, 'utf8'), 'momentia');
      await storage.remove('users/u1/photo.bin');
      await assert.rejects(readFile(target));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('local provider verifies staged variant checksums and atomically publishes files', async () => {
  await withCleanEnv(async () => {
    const root = await mkdtemp(join(tmpdir(), 'momentia-local-commit-'));
    process.env.MEDIA_STORAGE_DIR = root;
    try {
      const storage = new LocalMediaWorkerStorage();
      const target = await storage.ensureParent('variants/asset/video_poster.jpg');
      await writeFile(target, 'previous-valid-poster');
      const staged = await storage.ensureParent('variants/asset/video_poster.jpg.tmp-job');
      await writeFile(staged, 'new-poster');
      const checksum = createHash('sha256').update('new-poster').digest('hex');
      await storage.commit('variants/asset/video_poster.jpg', staged, checksum);
      assert.equal(await readFile(target, 'utf8'), 'new-poster');
      await assert.rejects(readFile(staged));

      const badStaged = await storage.ensureParent('variants/asset/video_poster.jpg.tmp-bad');
      await writeFile(badStaged, 'corrupt-poster');
      await assert.rejects(
        storage.commit('variants/asset/video_poster.jpg', badStaged, checksum),
        /failed SHA-256 verification/,
      );
      assert.equal(await readFile(target, 'utf8'), 'new-poster');
      assert.equal(await readFile(badStaged, 'utf8'), 'corrupt-poster');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test('local provider refuses symlinked parent directories and symlinked files', async () => {
  await withCleanEnv(async () => {
    const root = await mkdtemp(join(tmpdir(), 'momentia-symlink-root-'));
    const outside = await mkdtemp(join(tmpdir(), 'momentia-symlink-outside-'));
    process.env.MEDIA_STORAGE_DIR = root;
    try {
      const storage = new LocalMediaWorkerStorage();
      await symlink(outside, join(root, 'escape'), 'dir');
      await assert.rejects(storage.ensureParent('escape/payload.bin'), /Symbolic links/);
      await writeFile(join(outside, 'secret.bin'), 'secret');
      await symlink(join(outside, 'secret.bin'), join(root, 'secret-link.bin'));
      await assert.rejects(storage.stat('secret-link.bin'), /Symbolic links/);
      await assert.rejects(storage.remove('secret-link.bin'), /Symbolic links/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

test('provider factory rejects unsupported or incomplete S3 configuration', async () => {
  await withCleanEnv(async () => {
    assert.throws(() => createMediaWorkerStorage('gcs'), /Unsupported media storage provider/);
    assert.throws(() => createMediaWorkerStorage('s3'), /MEDIA_S3_BUCKET is required/);
    process.env.MEDIA_S3_BUCKET = 'momentia-test';
    process.env.MEDIA_S3_ACCESS_KEY_ID = 'only-half';
    assert.throws(() => createMediaWorkerStorage('s3'), /Both S3 access key and secret key/);
    delete process.env.MEDIA_S3_ACCESS_KEY_ID;
    assert.ok(createMediaWorkerStorage('s3') instanceof S3MediaWorkerStorage);
    assert.ok(createMediaWorkerStorage('local') instanceof LocalMediaWorkerStorage);
  });
});

test('S3 adapter streams downloads, uploads, reads metadata and removes objects and staging files', async () => {
  await withCleanEnv(async () => {
    const stage = await mkdtemp(join(tmpdir(), 'momentia-s3-stage-'));
    const originalSend = S3Client.prototype.send;
    const calls = [];
    let uploaded;
    let uploadedChecksum;
    const remote = Buffer.from('remote-object-content');
    S3Client.prototype.send = async function(command) {
      calls.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from([remote]) };
      }
      if (command instanceof HeadObjectCommand) {
        if (String(command.input.Key).includes('variant')) return { ContentLength: uploaded?.length, ChecksumSHA256: uploadedChecksum };
        return { ContentLength: remote.length };
      }
      if (command instanceof PutObjectCommand) {
        const chunks = [];
        for await (const chunk of command.input.Body) chunks.push(Buffer.from(chunk));
        uploaded = Buffer.concat(chunks);
        uploadedChecksum = command.input.ChecksumSHA256;
        return {};
      }
      if (command instanceof DeleteObjectCommand) return {};
      throw new Error('Unexpected S3 command');
    };
    process.env.MEDIA_S3_BUCKET = 'momentia-test';
    process.env.MEDIA_WORKER_TEMP_DIR = stage;
    try {
      const storage = new S3MediaWorkerStorage();
      const key = 'users/u1/media.bin';
      await assert.rejects(storage.materialize(key, remote.length + 1), /differs from the declared size/);
      assert.equal(calls.filter(command => command instanceof GetObjectCommand).length, 0);
      const local = await storage.materialize(key, remote.length);
      assert.deepEqual(await readFile(local), remote);
      assert.deepEqual(await storage.stat(key), { size: remote.length, isFile: true });

      const uploadSource = join(stage, 'upload-source.bin');
      await mkdir(stage, { recursive: true });
      await writeFile(uploadSource, Buffer.from('upload-content'));
      const expectedChecksum = createHash('sha256').update('upload-content').digest('hex');
      await storage.commit('users/u1/variant.webp', uploadSource, expectedChecksum);
      const put = calls.find(command => command instanceof PutObjectCommand);
      assert.ok(put);
      assert.equal(put.input.ServerSideEncryption, 'AES256');
      assert.deepEqual(uploaded, Buffer.from('upload-content'));
      assert.equal(uploadedChecksum, Buffer.from(expectedChecksum, 'hex').toString('base64'));
      assert.ok(calls.some(command => command instanceof HeadObjectCommand && command.input.ChecksumMode === 'ENABLED'));

      process.env.MEDIA_S3_SSE_KMS_KEY_ID = 'arn:aws:kms:us-east-1:123456789012:key/test-key';
      await storage.commit('users/u1/kms-variant.webp', uploadSource, expectedChecksum);
      const kmsPut = calls.filter(command => command instanceof PutObjectCommand).at(-1);
      assert.equal(kmsPut.input.ServerSideEncryption, 'aws:kms');
      assert.equal(kmsPut.input.SSEKMSKeyId, process.env.MEDIA_S3_SSE_KMS_KEY_ID);

      await storage.remove(key);
      assert.ok(calls.some(command => command instanceof DeleteObjectCommand));
      await assert.rejects(readFile(local));
    } finally {
      S3Client.prototype.send = originalSend;
      await rm(stage, { recursive: true, force: true });
    }
  });
});

test('S3 adapter deletes an object when post-upload checksum verification fails', async () => {
  await withCleanEnv(async () => {
    const stage = await mkdtemp(join(tmpdir(), 'momentia-s3-checksum-failure-'));
    const originalSend = S3Client.prototype.send;
    let deleted = false;
    S3Client.prototype.send = async function(command) {
      if (command instanceof PutObjectCommand) {
        for await (const _chunk of command.input.Body) { /* consume upload stream */ }
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        return { ContentLength: 7, ChecksumSHA256: 'incorrect-checksum' };
      }
      if (command instanceof DeleteObjectCommand) {
        deleted = true;
        return {};
      }
      throw new Error('Unexpected S3 command');
    };
    process.env.MEDIA_S3_BUCKET = 'momentia-test';
    process.env.MEDIA_WORKER_TEMP_DIR = stage;
    try {
      const storage = new S3MediaWorkerStorage();
      const source = join(stage, 'mismatch.bin');
      await writeFile(source, Buffer.from('payload'));
      const checksum = createHash('sha256').update('payload').digest('hex');
      await assert.rejects(storage.commit('variants/asset/mismatch.bin', source, checksum), /failed size or SHA-256 verification/);
      assert.equal(deleted, true);
    } finally {
      S3Client.prototype.send = originalSend;
      await rm(stage, { recursive: true, force: true });
    }
  });
});
