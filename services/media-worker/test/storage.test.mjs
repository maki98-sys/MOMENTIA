import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    const remote = Buffer.from('remote-object-content');
    S3Client.prototype.send = async function(command) {
      calls.push(command);
      if (command instanceof GetObjectCommand) {
        return { Body: Readable.from([remote]) };
      }
      if (command instanceof HeadObjectCommand) return { ContentLength: remote.length };
      if (command instanceof PutObjectCommand) {
        const chunks = [];
        for await (const chunk of command.input.Body) chunks.push(Buffer.from(chunk));
        this.uploaded = Buffer.concat(chunks);
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
      const local = await storage.materialize(key);
      assert.deepEqual(await readFile(local), remote);
      assert.deepEqual(await storage.stat(key), { size: remote.length, isFile: true });

      const uploadSource = join(stage, 'upload-source.bin');
      await mkdir(stage, { recursive: true });
      await writeFile(uploadSource, Buffer.from('upload-content'));
      await storage.commit('users/u1/variant.webp', uploadSource);
      const put = calls.find(command => command instanceof PutObjectCommand);
      assert.ok(put);
      assert.deepEqual(this.uploaded, Buffer.from('upload-content'));

      await storage.remove(key);
      assert.ok(calls.some(command => command instanceof DeleteObjectCommand));
      await assert.rejects(readFile(local));
    } finally {
      S3Client.prototype.send = originalSend;
      await rm(stage, { recursive: true, force: true });
    }
  });
});
