import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { renderImageVariant } from '../dist/image-processing.js';

test('image variants apply EXIF orientation and strip source metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'momentia-image-test-'));
  const source = join(directory, 'source.jpg');
  const target = join(directory, 'variant.webp');
  try {
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#abcdef' },
    }).jpeg().withMetadata({ orientation: 6 }).toFile(source);

    const rendered = await renderImageVariant(source, target, 128, 1_000);
    assert.equal(rendered.width, 20);
    assert.equal(rendered.height, 40);
    const metadata = await sharp(target).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.iptc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.ok((await readFile(target)).length > 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('image variants reject inputs exceeding the decoded pixel budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'momentia-image-limit-'));
  const source = join(directory, 'source.png');
  const target = join(directory, 'variant.webp');
  try {
    await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#abcdef' },
    }).png().toFile(source);
    await assert.rejects(
      renderImageVariant(source, target, 128, 100),
      /pixel|limit|exceed/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
