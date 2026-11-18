import * as FileSystem from 'expo-file-system/legacy';
import type { ImagePickerAsset } from 'expo-image-picker';
import { getLocalDatabase } from './database';

export type MediaDraft = {
  draft_id: string;
  local_uri: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  captured_at: string | null;
  created_at: string;
  sync_state: string;
};

export async function saveMediaDraft(asset: ImagePickerAsset): Promise<MediaDraft> {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('El almacenamiento local no está disponible.');

  const draftId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 12);
  const directory = root + 'momentia-media/';
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true }).catch(() => undefined);

  const extension = asset.mimeType?.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'jpg';
  const destination = directory + draftId + '.' + extension;
  await FileSystem.copyAsync({ from: asset.uri, to: destination });

  const info = await FileSystem.getInfoAsync(destination);
  if (!info.exists) throw new Error('No se pudo conservar el archivo en el dispositivo.');

  const now = new Date().toISOString();
  const draft: MediaDraft = {
    draft_id: draftId,
    local_uri: destination,
    file_name: asset.fileName || ('momentia-' + draftId + '.' + extension),
    mime_type: asset.mimeType ?? null,
    size_bytes: asset.fileSize ?? (info.size ?? null),
    captured_at: asset.exif?.DateTimeOriginal ? String(asset.exif.DateTimeOriginal) : null,
    created_at: now,
    sync_state: 'LOCAL_ONLY',
  };

  const db = await getLocalDatabase();
  await db.runAsync(
    'INSERT INTO media_drafts(draft_id,local_uri,file_name,mime_type,size_bytes,captured_at,created_at,sync_state) VALUES(?,?,?,?,?,?,?,?)',
    [draft.draft_id,draft.local_uri,draft.file_name,draft.mime_type,draft.size_bytes,draft.captured_at,draft.created_at,draft.sync_state],
  );
  return draft;
}

export async function listMediaDrafts(): Promise<MediaDraft[]> {
  const db = await getLocalDatabase();
  return db.getAllAsync<MediaDraft>('SELECT * FROM media_drafts ORDER BY created_at DESC LIMIT 50');
}
