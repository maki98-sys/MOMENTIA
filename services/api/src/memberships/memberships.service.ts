import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MembershipsService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string, spaceId: string) {
    const access = await this.database.query(
      `SELECT 1 FROM space_memberships WHERE space_id = $1 AND user_id = $2 AND state = 'active'`,
      [spaceId, userId],
    );
    if (!access.rowCount) throw new NotFoundException('Space not found.');
    const result = await this.database.query(
      `SELECT sm.user_id, sm.role, sm.state, sm.joined_at,
              u.display_name, u.avatar_url
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.space_id = $1 AND sm.state = 'active'
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, sm.joined_at`,
      [spaceId],
    );
    return result.rows;
  }

  async changeRole(actorId: string, spaceId: string, targetId: string, role: unknown) {
    if (!['admin', 'moderator', 'member', 'guest'].includes(String(role))) {
      throw new BadRequestException('Unsupported membership role.');
    }
    const result = await this.database.query(
      `UPDATE space_memberships target SET role = $4
       WHERE target.space_id = $2 AND target.user_id = $3 AND target.state = 'active'
         AND target.role <> 'owner'
         AND EXISTS (
           SELECT 1 FROM space_memberships actor
           WHERE actor.space_id = target.space_id AND actor.user_id = $1
             AND actor.state = 'active' AND actor.role IN ('owner','admin')
         )
         AND (target.role <> 'admin' OR EXISTS (
           SELECT 1 FROM space_memberships owner
           WHERE owner.space_id = target.space_id AND owner.user_id = $1
             AND owner.state = 'active' AND owner.role = 'owner'
         ))
         AND ($4 <> 'admin' OR EXISTS (
           SELECT 1 FROM space_memberships owner
           WHERE owner.space_id = target.space_id AND owner.user_id = $1
             AND owner.state = 'active' AND owner.role = 'owner'
         ))
       RETURNING user_id, role, state`,
      [actorId, spaceId, targetId, role],
    );
    if (!result.rowCount) throw new NotFoundException('Member not found or permission denied.');
    return result.rows[0];
  }

  async remove(actorId: string, spaceId: string, targetId: string) {
    if (actorId === targetId) throw new BadRequestException('Use the leave endpoint to remove yourself.');
    const result = await this.database.query(
      `UPDATE space_memberships target SET state = 'removed', left_at = now()
       WHERE target.space_id = $2 AND target.user_id = $3 AND target.state = 'active'
         AND target.role <> 'owner'
         AND EXISTS (
           SELECT 1 FROM space_memberships actor
           WHERE actor.space_id = target.space_id AND actor.user_id = $1
             AND actor.state = 'active' AND actor.role IN ('owner','admin','moderator')
         )
         AND (target.role <> 'admin' OR EXISTS (
           SELECT 1 FROM space_memberships owner
           WHERE owner.space_id = target.space_id AND owner.user_id = $1
             AND owner.state = 'active' AND owner.role = 'owner'
         ))
         AND (target.role <> 'moderator' OR EXISTS (
           SELECT 1 FROM space_memberships admin_or_owner
           WHERE admin_or_owner.space_id = target.space_id AND admin_or_owner.user_id = $1
             AND admin_or_owner.state = 'active' AND admin_or_owner.role IN ('owner','admin')
         ))
       RETURNING user_id, state, left_at`,
      [actorId, spaceId, targetId],
    );
    if (!result.rowCount) throw new NotFoundException('Member not found or permission denied.');
    return result.rows[0];
  }

  async transferOwnership(actorId: string, spaceId: string, targetId: string) {
    if (actorId === targetId) {
      throw new BadRequestException('Ownership must be transferred to another active member.');
    }
    return this.database.transaction(async (client) => {
      const locked = await client.query(
        `SELECT id FROM spaces
         WHERE id = $1 AND owner_id = $2 AND status = 'active'
         FOR UPDATE`,
        [spaceId, actorId],
      );
      if (!locked.rowCount) {
        throw new NotFoundException('Space not found or ownership permission denied.');
      }
      const target = await client.query(
        `SELECT user_id FROM space_memberships
         WHERE space_id = $1 AND user_id = $2 AND state = 'active' AND role <> 'owner'
         FOR UPDATE`,
        [spaceId, targetId],
      );
      if (!target.rowCount) {
        throw new BadRequestException('The new owner must already be an active member of this space.');
      }
      await client.query(
        `UPDATE space_memberships SET role = 'admin'
         WHERE space_id = $1 AND user_id = $2 AND state = 'active' AND role = 'owner'`,
        [spaceId, actorId],
      );
      await client.query(
        `UPDATE space_memberships SET role = 'owner'
         WHERE space_id = $1 AND user_id = $2 AND state = 'active'`,
        [spaceId, targetId],
      );
      await client.query(
        `UPDATE spaces SET owner_id = $2 WHERE id = $1`,
        [spaceId, targetId],
      );
      await client.query(
        `INSERT INTO space_audit_events
           (space_id, actor_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'ownership.transferred', 'space', $1, jsonb_build_object('newOwnerId', $3))`,
        [spaceId, actorId, targetId],
      );
      return { spaceId, previousOwnerId: actorId, ownerId: targetId };
    });
  }

  async leave(userId: string, spaceId: string) {
    const result = await this.database.query(
      `UPDATE space_memberships SET state = 'left', left_at = now()
       WHERE space_id = $1 AND user_id = $2 AND state = 'active' AND role <> 'owner'
       RETURNING user_id, state, left_at`,
      [spaceId, userId],
    );
    if (!result.rowCount) throw new BadRequestException('Owner transfer is required before leaving, or membership is inactive.');
    return result.rows[0];
  }
}
