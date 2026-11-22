import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFileIntegrity } from '../dist/file-integrity.js';

test('stored media integrity accepts the expected size and SHA-256', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'momentia-integrity-'));
  const path = join(directory, 'original.bin');
  const bytes = Buffer.from('momentia-original-fixture');
  try {
    await writeFile(path, bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await assert.doesNotReject(assertFileIntegrity(path, bytes.length, checksum));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stored media integrity rejects size and checksum changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'momentia-integrity-'));
  const path = join(directory, 'original.bin');
  const bytes = Buffer.from('momentia-original-fixture');
  try {
    await writeFile(path, bytes);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await assert.rejects(assertFileIntegrity(path, bytes.length + 1, checksum), /size differs/);
    await assert.rejects(assertFileIntegrity(path, bytes.length, '0'.repeat(64)), /checksum mismatch/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
