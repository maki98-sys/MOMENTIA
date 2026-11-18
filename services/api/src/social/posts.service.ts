import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { CreatePostInput, FeedCursor, ReactionType } from './post.types';

const POST_ACCESS = `(
  p.author_id = $1
  OR p.audience = 'public'
  OR (p.audience = 'followers' AND EXISTS (
    SELECT 1 FROM user_relationships r
    WHERE r.state = 'accepted'
      AND ((r.requester_id = $1 AND r.target_id = p.author_id)
        OR (r.requester_id = p.author_id AND r.target_id = $1))
  ))
  OR (p.audience = 'space' AND EXISTS (
    SELECT 1 FROM space_memberships sm
    WHERE sm.space_id = p.space_id AND sm.user_id = $1 AND sm.state = 'active'
  ))
)`;

@Injectable()
export class PostsService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, input: CreatePostInput) {
    return this.database.transaction(async (client) => {
      if (!input.body && !input.mediaAssetId) {
        throw new ConflictException('A post must contain text or ready media.');
      }
      if (input.mediaAssetId) {
        const media = await client.query(
          `SELECT id FROM media_assets
           WHERE id = $1 AND owner_id = $2 AND status = 'ready' AND deleted_at IS NULL
           FOR SHARE`,
          [input.mediaAssetId, userId],
        );
        if (!media.rowCount) throw new NotFoundException('Ready media owned by the authenticated user was not found.');
      }
      if (input.audience === 'space' && input.spaceId) {
        const membership = await client.query(
          `SELECT 1 FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
           WHERE s.id = $1 AND s.status = 'active'
             AND sm.user_id = $2 AND sm.state = 'active'
           FOR SHARE OF s, sm`,
          [input.spaceId, userId],
        );
        if (!membership.rowCount) throw new NotFoundException('Active space membership not found.');
      }

      const result = await client.query(
        `INSERT INTO posts (author_id, space_id, media_asset_id, body, audience, status, published_at)
         VALUES ($1, $2, $3, $4, $5, 'published', now())
         RETURNING id, author_id, space_id, media_asset_id, body, audience, published_at`,
        [userId, input.spaceId, input.mediaAssetId, input.body, input.audience],
      );
      const post = result.rows[0] as Record<string, unknown>;
      if (input.audience === 'space' && input.spaceId) {
        await client.query(
          `INSERT INTO timeline_entries (space_id, post_id, occurred_at, source)
           VALUES ($1, $2, now(), 'post')`,
          [input.spaceId, post.id],
        );
        await this.audit(client, input.spaceId, userId, 'post.published', String(post.id));
      }
      return mapPost(post, 0, 0);
    });
  }

  async feed(userId: string, cursor: FeedCursor | null, limit = 20) {
    const result = await this.database.query(
      `SELECT p.id, p.author_id, p.space_id, p.media_asset_id, p.body, p.audience, p.published_at,
              up.display_name,
              (SELECT count(*)::int FROM post_comments c
                WHERE c.post_id = p.id AND c.status = 'visible') AS comment_count,
              (SELECT count(*)::int FROM content_reactions r
                WHERE r.target_type = 'post' AND r.target_id = p.id) AS reaction_count,
              EXISTS (SELECT 1 FROM content_reactions mine
                WHERE mine.target_type = 'post' AND mine.target_id = p.id AND mine.user_id = $1) AS reacted_by_me
       FROM posts p
       JOIN users u ON u.id = p.author_id AND u.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = p.author_id
       WHERE p.status = 'published'
         AND ${POST_ACCESS}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )
         AND ($2::timestamptz IS NULL OR (p.published_at, p.id) < ($2::timestamptz, $3::uuid))
       ORDER BY p.published_at DESC, p.id DESC
       LIMIT $4`,
      [userId, cursor?.publishedAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const rows = result.rows as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(mapFeedRow);
    const last = page[page.length - 1];
    return {
      posts: page,
      nextCursor: hasMore && last
        ? Buffer.from(JSON.stringify({ publishedAt: last.publishedAt, id: last.id })).toString('base64url')
        : null,
    };
  }

  async get(userId: string, postId: string) {
    const result = await this.database.query(
      `SELECT p.id, p.author_id, p.space_id, p.media_asset_id, p.body, p.audience, p.published_at,
              up.display_name,
              (SELECT count(*)::int FROM post_comments c
                WHERE c.post_id = p.id AND c.status = 'visible') AS comment_count,
              (SELECT count(*)::int FROM content_reactions r
                WHERE r.target_type = 'post' AND r.target_id = p.id) AS reaction_count,
              EXISTS (SELECT 1 FROM content_reactions mine
                WHERE mine.target_type = 'post' AND mine.target_id = p.id AND mine.user_id = $1) AS reacted_by_me
       FROM posts p
       JOIN users u ON u.id = p.author_id AND u.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = p.author_id
       WHERE p.id = $2 AND p.status = 'published'
         AND ${POST_ACCESS}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )
       LIMIT 1`,
      [userId, postId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('Post not found.');
    return mapFeedRow(row);
  }

  async addComment(userId: string, postId: string, body: string) {
    return this.database.transaction(async (client) => {
      await this.requireVisiblePost(client, userId, postId);
      const result = await client.query(
        `INSERT INTO post_comments (post_id, author_id, body)
         VALUES ($1, $2, $3)
         RETURNING id, post_id, author_id, body, status, created_at`,
        [postId, userId, body],
      );
      const row = result.rows[0] as Record<string, unknown>;
      return {
        id: row.id,
        postId: row.post_id,
        authorId: row.author_id,
        body: row.body,
        status: row.status,
        createdAt: toIsoString(row.created_at as Date | string),
      };
    });
  }

  async listComments(userId: string, postId: string, limit = 50) {
    await this.requireVisiblePostWithPool(userId, postId);
    const result = await this.database.query(
      `SELECT c.id, c.author_id, c.body, c.created_at, up.display_name
       FROM post_comments c
       JOIN users u ON u.id = c.author_id AND u.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = c.author_id
       WHERE c.post_id = $1 AND c.status = 'visible'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $2 AND b.blocked_id = c.author_id)
              OR (b.blocker_id = c.author_id AND b.blocked_id = $2)
         )
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $3`,
      [postId, userId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      authorId: row.author_id,
      displayName: row.display_name,
      body: row.body,
      createdAt: toIsoString(row.created_at as Date | string),
    }));
  }

  async setReaction(userId: string, postId: string, reaction: ReactionType) {
    await this.requireVisiblePostWithPool(userId, postId);
    const result = await this.database.query(
      `INSERT INTO content_reactions (target_type, target_id, user_id, reaction_type)
       VALUES ('post', $1, $2, $3)
       ON CONFLICT (target_type, target_id, user_id)
       DO UPDATE SET reaction_type = EXCLUDED.reaction_type
       RETURNING target_type, target_id, user_id, reaction_type, created_at`,
      [postId, userId, reaction],
    );
    const row = result.rows[0] as Record<string, unknown>;
    return { postId: row.target_id, reaction: row.reaction_type, createdAt: toIsoString(row.created_at as Date | string) };
  }

  async removeReaction(userId: string, postId: string): Promise<void> {
    await this.requireVisiblePostWithPool(userId, postId);
    await this.database.query(
      "DELETE FROM content_reactions WHERE target_type = 'post' AND target_id = $1 AND user_id = $2",
      [postId, userId],
    );
  }

  private async requireVisiblePost(client: PoolClient, userId: string, postId: string): Promise<void> {
    const result = await client.query(
      `SELECT p.id FROM posts p
       JOIN users u ON u.id = p.author_id AND u.status = 'active'
       WHERE p.id = $2 AND p.status = 'published'
         AND ${POST_ACCESS}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )
       FOR SHARE OF p`,
      [userId, postId],
    );
    if (!result.rowCount) throw new NotFoundException('Post not found.');
  }

  private async requireVisiblePostWithPool(userId: string, postId: string): Promise<void> {
    const result = await this.database.query(
      `SELECT p.id FROM posts p
       JOIN users u ON u.id = p.author_id AND u.status = 'active'
       WHERE p.id = $2 AND p.status = 'published'
         AND ${POST_ACCESS}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )
       LIMIT 1`,
      [userId, postId],
    );
    if (!result.rowCount) throw new NotFoundException('Post not found.');
  }

  private async audit(client: PoolClient, spaceId: string, actorId: string, action: string, postId: string) {
    await client.query(
      `INSERT INTO space_audit_events (space_id, actor_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, 'post', $4)`,
      [spaceId, actorId, action, postId],
    );
  }
}

function mapPost(row: Record<string, unknown>, commentCount: number, reactionCount: number) {
  return {
    id: row.id,
    authorId: row.author_id,
    spaceId: row.space_id,
    mediaAssetId: row.media_asset_id,
    body: row.body,
    audience: row.audience,
    publishedAt: toIsoString(row.published_at as Date | string),
    commentCount,
    reactionCount,
  };
}

function mapFeedRow(row: Record<string, unknown>) {
  return {
    ...mapPost(row, Number(row.comment_count), Number(row.reaction_count)),
    displayName: row.display_name,
    reactedByMe: Boolean(row.reacted_by_me),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
