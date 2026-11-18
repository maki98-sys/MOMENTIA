import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

type RelationshipState = 'pending' | 'accepted' | 'rejected';

@Injectable()
export class ConnectionsService {
  constructor(private readonly database: DatabaseService) {}

  async follow(userId: string, targetId: string) {
    this.assertDifferentUsers(userId, targetId);
    return this.database.transaction(async (client) => {
      await this.lockActiveUsers(client, userId, targetId);
      await this.assertNotBlocked(client, userId, targetId);
      const existing = await client.query<{ requester_id: string; target_id: string; state: RelationshipState }>(
        `SELECT requester_id, target_id, state FROM user_relationships
         WHERE (requester_id = $1 AND target_id = $2)
            OR (requester_id = $2 AND target_id = $1)
         FOR UPDATE`,
        [userId, targetId],
      );
      const outgoing = existing.rows.find((row) => row.requester_id === userId);
      const incoming = existing.rows.find((row) => row.requester_id === targetId);

      if (outgoing?.state === 'accepted') {
        if (incoming?.state === 'pending') {
          await client.query(
            `UPDATE user_relationships SET state = 'accepted', updated_at = now()
             WHERE requester_id = $1 AND target_id = $2`,
            [targetId, userId],
          );
        }
        return { state: 'accepted' };
      }
      if (incoming?.state === 'pending' || incoming?.state === 'accepted') {
        await client.query(
          `UPDATE user_relationships SET state = 'accepted', updated_at = now()
           WHERE requester_id = $1 AND target_id = $2`,
          [targetId, userId],
        );
        await client.query(
          `INSERT INTO user_relationships (requester_id, target_id, state)
           VALUES ($1, $2, 'accepted')
           ON CONFLICT (requester_id, target_id) DO UPDATE
           SET state = 'accepted', updated_at = now()`,
          [userId, targetId],
        );
        return { state: 'accepted' };
      }
      if (outgoing?.state === 'pending') return { state: 'pending' };
      if (outgoing) {
        await client.query(
          `UPDATE user_relationships SET state = 'pending', updated_at = now()
           WHERE requester_id = $1 AND target_id = $2`,
          [userId, targetId],
        );
      } else {
        await client.query(
          `INSERT INTO user_relationships (requester_id, target_id, state)
           VALUES ($1, $2, 'pending')`,
          [userId, targetId],
        );
      }
      return { state: 'pending' };
    });
  }

  async accept(userId: string, requesterId: string) {
    this.assertDifferentUsers(userId, requesterId);
    return this.database.transaction(async (client) => {
      await this.lockActiveUsers(client, userId, requesterId);
      await this.assertNotBlocked(client, userId, requesterId);
      const accepted = await client.query(
        `UPDATE user_relationships SET state = 'accepted', updated_at = now()
         WHERE requester_id = $1 AND target_id = $2 AND state = 'pending'
         RETURNING id`,
        [requesterId, userId],
      );
      if (!accepted.rowCount) throw new NotFoundException('Pending follow request not found.');
      await client.query(
        `INSERT INTO user_relationships (requester_id, target_id, state)
         VALUES ($1, $2, 'accepted')
         ON CONFLICT (requester_id, target_id) DO UPDATE
         SET state = 'accepted', updated_at = now()`,
        [userId, requesterId],
      );
      return { state: 'accepted' };
    });
  }

  async reject(userId: string, requesterId: string) {
    this.assertDifferentUsers(userId, requesterId);
    const result = await this.database.query(
      `UPDATE user_relationships SET state = 'rejected', updated_at = now()
       WHERE requester_id = $1 AND target_id = $2 AND state = 'pending'`,
      [requesterId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Pending follow request not found.');
    return { state: 'rejected' };
  }

  async unfollow(userId: string, targetId: string) {
    this.assertDifferentUsers(userId, targetId);
    return this.database.transaction(async (client) => {
      await this.lockActiveUsers(client, userId, targetId);
      await client.query(
        `DELETE FROM user_relationships
         WHERE (requester_id = $1 AND target_id = $2)
            OR (requester_id = $2 AND target_id = $1)`,
        [userId, targetId],
      );
      return { success: true };
    });
  }

  async block(userId: string, targetId: string) {
    this.assertDifferentUsers(userId, targetId);
    return this.database.transaction(async (client) => {
      await this.lockActiveUsers(client, userId, targetId);
      await client.query(
        `INSERT INTO user_blocks (blocker_id, blocked_id)
         VALUES ($1, $2) ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
        [userId, targetId],
      );
      await client.query(
        `DELETE FROM user_relationships
         WHERE (requester_id = $1 AND target_id = $2)
            OR (requester_id = $2 AND target_id = $1)`,
        [userId, targetId],
      );
      return { success: true };
    });
  }

  async unblock(userId: string, targetId: string) {
    this.assertDifferentUsers(userId, targetId);
    const result = await this.database.query(
      'DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [userId, targetId],
    );
    return { success: true, removed: Boolean(result.rowCount) };
  }

  async list(
    userId: string,
    kind: 'following' | 'followers' | 'requests',
    cursorValue?: string,
    requestedLimit = 20,
  ) {
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50.');
    }
    const cursor = cursorValue ? decodeConnectionCursor(cursorValue) : null;
    const result = await this.database.query<{
      relationship_id: string;
      created_at: Date | string;
      user_id: string;
      display_name: string | null;
      avatar_media_id: string | null;
    }>(
      `SELECT r.id AS relationship_id, r.created_at,
              u.id AS user_id, up.display_name, up.avatar_media_id
       FROM user_relationships r
       JOIN users u
         ON u.id = CASE WHEN $2 = 'following' THEN r.target_id ELSE r.requester_id END
        AND u.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE (
         ($2 = 'following' AND r.requester_id = $1 AND r.state = 'accepted')
         OR ($2 = 'followers' AND r.target_id = $1 AND r.state = 'accepted')
         OR ($2 = 'requests' AND r.target_id = $1 AND r.state = 'pending')
       )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $1)
         )
         AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $5`,
      [userId, kind, cursor?.createdAt ?? null, cursor?.id ?? null, requestedLimit + 1],
    );
    const hasMore = result.rows.length > requestedLimit;
    const page = result.rows.slice(0, requestedLimit).map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarMediaId: row.avatar_media_id,
      createdAt: toIsoString(row.created_at),
    }));
    const last = result.rows.slice(0, requestedLimit).at(-1);
    return {
      users: page,
      hasMore,
      nextCursor: hasMore && last
        ? encodeConnectionCursor({ createdAt: toIsoString(last.created_at), id: last.relationship_id })
        : null,
    };
  }

  private async lockActiveUsers(client: PoolClient, userId: string, targetId: string): Promise<void> {
    const result = await client.query(
      `SELECT id FROM users
       WHERE id = ANY($1::uuid[]) AND status = 'active'
       ORDER BY id FOR UPDATE`,
      [[userId, targetId]],
    );
    if (result.rowCount !== 2) throw new NotFoundException('Active user not found.');
  }

  private async assertNotBlocked(client: PoolClient, userId: string, targetId: string): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM user_blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1`,
      [userId, targetId],
    );
    if (result.rowCount) throw new ForbiddenException('This relationship cannot be created.');
  }

  private assertDifferentUsers(userId: string, targetId: string): void {
    if (userId === targetId) throw new BadRequestException('You cannot create a relationship with yourself.');
  }
}

type ConnectionCursor = { createdAt: string; id: string };

function encodeConnectionCursor(cursor: ConnectionCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeConnectionCursor(value: string): ConnectionCursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException('cursor is invalid.');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.createdAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.createdAt))
      || typeof candidate.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.id)) {
      throw new Error('invalid');
    }
    return { createdAt: new Date(candidate.createdAt).toISOString(), id: candidate.id };
  } catch {
    throw new BadRequestException('cursor is invalid.');
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
