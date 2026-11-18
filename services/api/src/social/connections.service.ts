import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
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

      if (outgoing?.state === 'accepted' || outgoing?.state === 'pending') {
        return { state: outgoing.state };
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
