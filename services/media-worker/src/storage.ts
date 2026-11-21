import { mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export abstract class MediaWorkerStorage {
  abstract pathFor(storageKey: string): string;
  abstract ensureParent(storageKey: string): Promise<string>;
  abstract remove(storageKey: string): Promise<void>;
  abstract stat(storageKey: string): Promise<{ size: number; isFile: boolean }>;
}

export class LocalMediaWorkerStorage extends MediaWorkerStorage {
  private readonly root = resolve(process.env.MEDIA_STORAGE_DIR ?? '/var/lib/momentia/media');

  pathFor(storageKey: string): string {
    if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..') ||
        storageKey.includes('\\\\') || storageKey.includes('\\0')) {
      throw new Error('Unsafe storage key');
    }
    const target = resolve(join(this.root, storageKey));
    if (!target.startsWith(this.root + '/')) throw new Error('Storage path escapes configured root');
    return target;
  }

  async ensureParent(storageKey: string): Promise<string> {
    const target = this.pathFor(storageKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    return target;
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }

  async stat(storageKey: string): Promise<{ size: number; isFile: boolean }> {
    const info = await stat(this.pathFor(storageKey));
    return { size: info.size, isFile: info.isFile() };
  }
}
