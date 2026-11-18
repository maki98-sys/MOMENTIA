import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

type AlbumSortMode = 'captured_at' | 'uploaded_at' | 'added_at';

@Injectable()
export class EventAlbumsService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, spaceId: string, title: string, sortMode: AlbumSortMode) {
    return this.database.transaction(async (client) => {
      const access = await this.requireEventRole(client, userId, spaceId);
      if (!['owner', 'admin', 'moderator'].includes(access.role)) {
        throw new ForbiddenException('Only space managers can create event albums.');
      }
      const result = await client.query(
        `INSERT INTO event_albums (space_id, created_by, title, sort_mode)
         VALUES ($1, $2, $3, $4)
         RETURNING id, space_id, title, sort_mode, created_at, updated_at`,
        [spaceId, userId, title, sortMode],
      );
      const album = result.rows[0] as Record<string, unknown>;
      await this.audit(client, spaceId, userId, 'event_album.created', 'event_album', String(album.id));
      return mapAlbum(album, 0);
    });
  }

  async list(userId: string, spaceId: string) {
    const access = await this.database.query(
      `SELECT 1 FROM spaces s
       JOIN space_memberships sm ON sm.space_id = s.id
       WHERE s.id = $1 AND s.type = 'EVENT' AND s.status = 'active'
         AND sm.user_id = $2 AND sm.state = 'active'
       LIMIT 1`,
      [spaceId, userId],
    );
    if (!access.rowCount) throw new NotFoundException('Event space not found.');
    const result = await this.database.query(
      `SELECT a.id, a.space_id, a.title, a.sort_mode, a.created_at, a.updated_at,
              count(i.id)::int AS item_count
       FROM event_albums a
       LEFT JOIN event_album_items i ON i.album_id = a.id
       WHERE a.space_id = $1
       GROUP BY a.id
       ORDER BY a.created_at ASC, a.id ASC`,
      [spaceId],
    );
    return result.rows.map((row) => mapAlbum(row as Record<string, unknown>, Number(row.item_count)));
  }

  async listItems(userId: string, albumId: string) {
    const access = await this.database.query(
      `SELECT a.id, a.sort_mode FROM event_albums a
       JOIN space_memberships sm ON sm.space_id = a.space_id
       JOIN spaces s ON s.id = a.space_id
       WHERE a.id = $1 AND s.type = 'EVENT' AND s.status = 'active'
         AND sm.user_id = $2 AND sm.state = 'active'
       LIMIT 1`,
      [albumId, userId],
    );
    if (!access.rowCount) throw new NotFoundException('Event album not found.');
    const result = await this.database.query(
      `SELECT i.id, i.media_asset_id, i.added_by, i.position, i.added_at,
              m.mime_type_detected, m.size_bytes, m.width, m.height, mm.captured_at,
              mm.captured_timezone
       FROM event_album_items i
       JOIN media_assets m ON m.id = i.media_asset_id
       LEFT JOIN media_metadata mm ON mm.media_asset_id = m.id
       WHERE i.album_id = $1 AND m.status = 'ready' AND m.deleted_at IS NULL
       ORDER BY
         CASE WHEN (SELECT sort_mode FROM event_albums WHERE id = $1) = 'captured_at'
              THEN COALESCE(mm.captured_at, i.added_at)
              WHEN (SELECT sort_mode FROM event_albums WHERE id = $1) = 'uploaded_at'
              THEN COALESCE(mm.uploaded_at, i.added_at)
              ELSE i.added_at END DESC,
         i.id DESC`,
      [albumId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      mediaAssetId: row.media_asset_id,
      addedBy: row.added_by,
      position: row.position,
      addedAt: toIsoString(row.added_at as Date | string),
      mimeType: row.mime_type_detected,
      sizeBytes: Number(row.size_bytes),
      width: row.width,
      height: row.height,
      capturedAt: row.captured_at ? toIsoString(row.captured_at as Date | string) : null,
      capturedTimezone: row.captured_timezone,
    }));
  }

  async addMedia(userId: string, albumId: string, mediaAssetId: string) {
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `SELECT a.space_id, s.status, sm.role
         FROM event_albums a
         JOIN spaces s ON s.id = a.space_id
         JOIN space_memberships sm ON sm.space_id = s.id
         WHERE a.id = $1 AND s.type = 'EVENT'
           AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF a, s, sm`,
        [albumId, userId],
      );
      const album = result.rows[0] as { space_id: string; status: string; role: string } | undefined;
      if (!album) throw new NotFoundException('Event album not found.');
      if (album.status !== 'active') throw new ConflictException('The event is not active.');

      const media = await client.query(
        `SELECT id FROM media_assets
         WHERE id = $1 AND owner_id = $2 AND status = 'ready' AND deleted_at IS NULL
         FOR SHARE`,
        [mediaAssetId, userId],
      );
      if (!media.rowCount) throw new NotFoundException('Ready media owned by the authenticated user was not found.');

      const positionResult = await client.query(
        'SELECT COALESCE(MAX(position) + 1, 0)::int AS next_position FROM event_album_items WHERE album_id = $1',
        [albumId],
      );
      const position = Number((positionResult.rows[0] as { next_position: number }).next_position);
      const inserted = await client.query(
        `INSERT INTO event_album_items (album_id, media_asset_id, added_by, position)
         VALUES ($1, $2, $3, $4)
         RETURNING id, media_asset_id, position, added_at`,
        [albumId, mediaAssetId, userId, position],
      );
      const item = inserted.rows[0] as Record<string, unknown>;
      await client.query(
        `INSERT INTO timeline_entries (space_id, media_asset_id, occurred_at, source)
         VALUES ($1, $2, now(), 'upload')
         ON CONFLICT (space_id, media_asset_id) WHERE media_asset_id IS NOT NULL DO NOTHING`,
        [album.space_id, mediaAssetId],
      );
      await this.audit(client, album.space_id, userId, 'event_album.media_added', 'event_album_item', String(item.id));
      return {
        id: item.id,
        mediaAssetId: item.media_asset_id,
        position: item.position,
        addedAt: toIsoString(item.added_at as Date | string),
      };
    });
  }

  async removeMedia(userId: string, albumId: string, mediaAssetId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `SELECT a.space_id, s.status, sm.role, i.id AS item_id, i.added_by
         FROM event_albums a
         JOIN spaces s ON s.id = a.space_id
         JOIN space_memberships sm ON sm.space_id = s.id
         JOIN event_album_items i ON i.album_id = a.id AND i.media_asset_id = $3
         WHERE a.id = $1 AND s.type = 'EVENT'
           AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF a, s, i, sm`,
        [albumId, userId, mediaAssetId],
      );
      const row = result.rows[0] as {
        space_id: string; status: string; role: string; item_id: string; added_by: string;
      } | undefined;
      if (!row) throw new NotFoundException('Album item not found.');
      if (row.status !== 'active') throw new ConflictException('The event is not active.');
      if (row.added_by !== userId && !['owner', 'admin', 'moderator'].includes(row.role)) {
        throw new ForbiddenException('Only the contributor or a space manager can remove this item.');
      }
      await client.query('DELETE FROM event_album_items WHERE id = $1', [row.item_id]);
      await client.query(
        `DELETE FROM timeline_entries t
         WHERE t.space_id = $1 AND t.media_asset_id = $2 AND t.source = 'upload'
           AND NOT EXISTS (
             SELECT 1 FROM event_album_items i
             JOIN event_albums a ON a.id = i.album_id
             WHERE a.space_id = $1 AND i.media_asset_id = $2
           )`,
        [row.space_id, mediaAssetId],
      );
      await this.audit(client, row.space_id, userId, 'event_album.media_removed', 'event_album_item', row.item_id);
    });
  }

  private async requireEventRole(client: PoolClient, userId: string, spaceId: string) {
    const result = await client.query(
      `SELECT s.type, s.status, sm.role
       FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
       WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
       FOR UPDATE OF s, sm`,
      [spaceId, userId],
    );
    const row = result.rows[0] as { type: string; status: string; role: string } | undefined;
    if (!row || row.type !== 'EVENT') throw new NotFoundException('Event space not found.');
    if (row.status !== 'active') throw new ConflictException('The event is not active.');
    return row;
  }

  private async audit(client: PoolClient, spaceId: string, actorId: string, action: string,
    resourceType: string, resourceId: string): Promise<void> {
    await client.query(
      `INSERT INTO space_audit_events (space_id, actor_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [spaceId, actorId, action, resourceType, resourceId],
    );
  }
}

function mapAlbum(row: Record<string, unknown>, itemCount: number) {
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    sortMode: row.sort_mode,
    itemCount,
    createdAt: toIsoString(row.created_at as Date | string),
    updatedAt: toIsoString(row.updated_at as Date | string),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
