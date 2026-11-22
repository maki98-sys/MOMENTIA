import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

/** Re-hash the stored original at every processing boundary to detect replacement after inspection or scanning. */
export async function assertFileIntegrity(
  path: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<void> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw new Error('Expected media size is invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error('Expected media checksum is invalid');
  }
  const info = await stat(path);
  if (info.size !== expectedSize) {
    throw new Error('Stored file size differs from the declared size');
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  if (hash.digest('hex') !== expectedSha256.toLowerCase()) {
    throw new Error('Stored file checksum mismatch');
  }
}
