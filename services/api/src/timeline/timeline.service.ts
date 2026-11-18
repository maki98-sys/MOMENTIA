import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type TimelineCursor = { occurredAt: string; id: string };
type TimelineRow = {
  id: string;
  source: string;
  occurred_at: Date | string;
  post_id: string | null;
  media_asset_id: string | null;
  author_id: string | null;
  display_name: string | null;
  body: string | null;
  audience: string | null;
  published_at: Date | string | null;
  mime_type_detected: string | null;
  size_bytes: string | null;
  width: number | null;
  height: number | null;
};

@Injectable()
export class TimelineService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string, spaceId: string, cursorValue?: string, requestedLimit = 20) {
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50.');
    }
    const cursor = cursorValue ? decodeCursor(cursorValue) : null;
    const membership = await this.database.query(
      `SELECT 1 FROM spaces s
       JOIN space_memberships sm ON sm.space_id = s.id
       WHERE s.id = $1 AND s.status = 'active'
         AND sm.user_id = $2 AND sm.state = 'active'
       LIMIT 1`,
      [spaceId, userId],
    );
    if (!membership.rowCount) throw new NotFoundException('Space timeline not found.');

    const result = await this.database.query<TimelineRow>(
      `SELECT t.id, t.source, t.occurred_at, t.post_id, t.media_asset_id,
              p.author_id, up.display_name, p.body, p.audience, p.published_at,
              m.mime_type_detected, m.size_bytes, m.width, m.height
       FROM timeline_entries t
       JOIN spaces s ON s.id = t.space_id AND s.status = 'active'
       JOIN space_memberships sm ON sm.space_id = s.id
         AND sm.user_id = $2 AND sm.state = 'active'
       LEFT JOIN posts p ON p.id = t.post_id
       LEFT JOIN users author ON author.id = p.author_id AND author.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = p.author_id
       LEFT JOIN media_assets m ON m.id = t.media_asset_id
       WHERE t.space_id = $1
         AND ($3::timestamptz IS NULL OR (t.occurred_at, t.id) < ($3::timestamptz, $4::uuid))
         AND (
           (
             t.post_id IS NOT NULL AND p.status = 'published'
             AND author.id IS NOT NULL
             AND (
               p.author_id = $2
               OR p.audience = 'public'
               OR (p.audience = 'followers' AND EXISTS (
                 SELECT 1 FROM user_relationships r
                 WHERE r.state = 'accepted'
                   AND ((r.requester_id = $2 AND r.target_id = p.author_id)
                     OR (r.requester_id = p.author_id AND r.target_id = $2))
               ))
               OR (p.audience = 'space' AND EXISTS (
                 SELECT 1 FROM space_memberships post_membership
                 WHERE post_membership.space_id = p.space_id
                   AND post_membership.user_id = $2 AND post_membership.state = 'active'
               ))
             )
             AND NOT EXISTS (
               SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id = $2 AND b.blocked_id = p.author_id)
                  OR (b.blocker_id = p.author_id AND b.blocked_id = $2)
             )
           )
           OR (
             t.media_asset_id IS NOT NULL AND m.status = 'ready' AND m.deleted_at IS NULL
             AND (
               m.owner_id = $2
               OR EXISTS (
                 SELECT 1 FROM media_access_grants g
                 WHERE g.media_asset_id = m.id AND g.subject_type = 'space'
                   AND g.subject_id = s.id AND g.permission IN ('view','download')
                   AND (g.expires_at IS NULL OR g.expires_at > now())
               )
               OR EXISTS (
                 SELECT 1 FROM event_album_items i
                 JOIN event_albums a ON a.id = i.album_id
                 WHERE a.space_id = s.id AND i.media_asset_id = m.id
               )
             )
           )
         )
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT $5`,
      [spaceId, userId, cursor?.occurredAt ?? null, cursor?.id ?? null, requestedLimit + 1],
    );

    const rows = result.rows;
    const hasMore = rows.length > requestedLimit;
    const page = rows.slice(0, requestedLimit).map(mapTimelineRow);
    const last = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && last
        ? encodeCursor({ occurredAt: last.occurredAt, id: last.id })
        : null,
      hasMore,
    };
  }
}

function mapTimelineRow(row: TimelineRow) {
  const occurredAt = toIsoString(row.occurred_at);
  return {
    id: row.id,
    type: row.post_id ? 'post' : 'media',
    source: row.source,
    occurredAt,
    post: row.post_id ? {
      id: row.post_id,
      authorId: row.author_id,
      displayName: row.display_name,
      body: row.body,
      audience: row.audience,
      publishedAt: row.published_at ? toIsoString(row.published_at) : null,
    } : null,
    media: row.media_asset_id ? {
      id: row.media_asset_id,
      mimeType: row.mime_type_detected,
      sizeBytes: Number(row.size_bytes),
      width: row.width,
      height: row.height,
    } : null,
  };
}

function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): TimelineCursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException('cursor is invalid.');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.occurredAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.occurredAt))
      || typeof candidate.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.id)) {
      throw new Error('invalid');
    }
    return { occurredAt: new Date(candidate.occurredAt).toISOString(), id: candidate.id };
  } catch {
    throw new BadRequestException('cursor is invalid.');
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
