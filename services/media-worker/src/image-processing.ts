import sharp from 'sharp';

export type RenderedImageVariant = {
  size: number;
  width: number;
  height: number;
};

/**
 * Render a normalized WebP derivative. Sharp strips source metadata by default;
 * do not add withMetadata()/keepMetadata(), because originals may contain GPS.
 */
export async function renderImageVariant(
  sourcePath: string,
  targetPath: string,
  width: number,
  maxPixels: number,
): Promise<RenderedImageVariant> {
  if (!Number.isInteger(width) || width < 1 || width > 4096) {
    throw new Error('Image variant width must be between 1 and 4096 pixels');
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1) {
    throw new Error('Image pixel limit must be a positive safe integer');
  }
  const output = await sharp(sourcePath, {
    failOn: 'error',
    limitInputPixels: maxPixels,
    sequentialRead: true,
  })
    .rotate()
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toFile(targetPath);
  if (!output.width || !output.height) {
    throw new Error('Rendered image dimensions could not be determined');
  }
  return { size: output.size, width: output.width, height: output.height };
}
