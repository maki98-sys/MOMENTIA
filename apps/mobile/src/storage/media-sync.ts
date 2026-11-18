import * as FileSystem from 'expo-file-system/legacy';
import { toByteArray } from 'base64-js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { env } from '../config/env';
import { tokenStore } from '../auth/token-store';
import { apiRequest } from '../api/client';
import { getLocalDatabase } from './database';
import { listMediaDrafts, MediaDraft } from './media-drafts';

type CreateUploadResponse = {
  id?: string;
  upload_id?: string;
  media_asset_id?: string;
  state: string;
};

type UploadResponse = {
  id: string;
  state: string;
  media_asset_id: string;
  asset_status: string;
};

export type MediaSyncResult = {
  draftId: string;
  state: 'SYNCED' | 'FAILED' | 'SKIPPED';
  message: string;
};

function mimeForDraft(draft: MediaDraft): string {
  const mime = draft.mime_type || 'image/jpeg';
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowed.includes(mime)) throw new Error('Formato de imagen no admitido para sincronización.');
  return mime;
}

async function setDraftState(
  draftId: string,
  state: string,
  values: { uploadId?: string; assetId?: string; error?: string } = {},
) {
  const db = await getLocalDatabase();
  await db.runAsync(
    `UPDATE media_drafts
     SET sync_state=?, upload_id=COALESCE(?,upload_id),
         remote_media_asset_id=COALESCE(?,remote_media_asset_id), last_error=?
     WHERE draft_id=?`,
    [state, values.uploadId ?? null, values.assetId ?? null, values.error ?? null, draftId],
  );
}

async function uploadOne(draft: MediaDraft): Promise<MediaSyncResult> {
  try {
    if (!draft.local_uri) throw new Error('No existe el archivo local.');
    const info = await FileSystem.getInfoAsync(draft.local_uri);
    if (!info.exists || !info.size || info.size > 50 * 1024 * 1024) {
      throw new Error('El archivo no existe o supera el límite de 50 MB.');
    }
    const mimeType = mimeForDraft(draft);
    const base64 = await FileSystem.readAsStringAsync(draft.local_uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = toByteArray(base64);
    if (bytes.length !== info.size) throw new Error('No se pudo leer el archivo completo.');
    const checksumSha256 = bytesToHex(sha256(bytes));

    await setDraftState(draft.draft_id, 'UPLOADING');
    const created = await apiRequest<CreateUploadResponse>('/media/uploads', {
      method: 'POST',
      headers: { 'Idempotency-Key': draft.draft_id },
      body: JSON.stringify({
        fileName: draft.file_name,
        mimeType,
        sizeBytes: bytes.length,
        checksumSha256,
        ...(draft.captured_at ? { capturedAt: draft.captured_at } : {}),
        gpsConsent: false,
      }),
    });
    const uploadId = created.upload_id ?? created.id;
    if (!uploadId) throw new Error('El servidor no devolvió el identificador de carga.');
    await setDraftState(draft.draft_id, 'UPLOADING', { uploadId });

    const token = await tokenStore.get();
    if (!token) throw new Error('Inicia sesión para subir tus fotografías.');
    const result = await FileSystem.uploadAsync(
      `${env.apiUrl}/media/uploads/${uploadId}/content`,
      draft.local_uri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          Accept: 'application/json',
        },
      },
    );
    if (result.status < 200 || result.status >= 300) {
      let message = 'El servidor no pudo recibir la fotografía.';
      try {
        const body = JSON.parse(result.body) as { message?: string };
        message = body.message ?? message;
      } catch { /* Keep the safe fallback message. */ }
      throw new Error(message);
    }
    const response = JSON.parse(result.body) as UploadResponse;
    await setDraftState(draft.draft_id, 'SYNCED', { uploadId, assetId: response.media_asset_id });
    return {
      draftId: draft.draft_id,
      state: 'SYNCED',
      message: 'Bytes enviados; fotografía en cuarentena para revisión del servidor.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado al sincronizar.';
    await setDraftState(draft.draft_id, 'FAILED', { error: message });
    return { draftId: draft.draft_id, state: 'FAILED', message };
  }
}

export async function syncPendingMedia(): Promise<MediaSyncResult[]> {
  const drafts = await listMediaDrafts();
  const pending = drafts.filter(draft => draft.sync_state !== 'SYNCED');
  const results: MediaSyncResult[] = [];
  for (const draft of pending) results.push(await uploadOne(draft));
  return results;
}
