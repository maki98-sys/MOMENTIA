import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalMediaStorage } from './media-storage.service';

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
