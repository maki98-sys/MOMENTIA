import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type {
  CreateInvitationInput,
  CreateSpaceInput,
  SpaceSummary,
  SpaceType,
} from './space.types';

interface SpaceRow extends Record<string, unknown> {
  id: string;
  type: SpaceType;
  name: string;
  visibility: 'public' | 'unlisted' | 'private';
  status: 'active' | 'archived' | 'closed';
  role: 'owner' | 'admin' | 'moderator' | 'member' | 'guest';
  created_at: Date | string;
}

interface InvitationRow extends Record<string, unknown> {
  id: string;
  space_id: string;
  type: SpaceType;
  status: string;
  expires_at: Date | string;
  max_uses: number;
  uses: number;
  revoked_at: Date | string | null;
  role: 'admin' | 'moderator' | 'member' | 'guest';
}

@Injectable()
export class SpacesService {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, input: CreateSpaceInput): Promise<SpaceSummary> {
    return this.database.transaction(async (client) => {
      if (input.type === 'COUPLE') {
        if (!input.partnerUserId || input.partnerUserId === userId) {
          throw new ConflictException('A COUPLE space requires a second, different active user.');
        }
        const partner = await client.query(
          "SELECT id FROM users WHERE id = $1 AND status = 'active' FOR SHARE",
          [input.partnerUserId],
        );
        if (!partner.rowCount) throw new NotFoundException('The partner account was not found or is not active.');
      }

      const inserted = await client.query(
        `INSERT INTO spaces (type, owner_id, name, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING id, type, name, visibility, status, created_at`,
        [input.type, userId, input.name, input.visibility],
      );
      const space = inserted.rows[0] as {
        id: string; type: SpaceType; name: string; visibility: 'public' | 'unlisted' | 'private';
        status: 'active' | 'archived' | 'closed'; created_at: Date | string;
      };

      if (input.type === 'EVENT') {
        await client.query(
          `INSERT INTO event_details (space_id, starts_at, ends_at, timezone)
           VALUES ($1, $2, $3, $4)`,
          [space.id, input.startsAt ?? null, input.endsAt ?? null, input.timezone ?? 'UTC'],
        );
      } else if (input.type === 'COUPLE') {
        await client.query('INSERT INTO couple_details (space_id) VALUES ($1)', [space.id]);
      } else {
        await client.query(
          'INSERT INTO circle_details (space_id, description, join_policy) VALUES ($1, $2, $3)',
          [space.id, input.description ?? null, input.joinPolicy ?? 'invite'],
        );
      }

      await client.query(
        `INSERT INTO space_memberships (space_id, user_id, role, state, joined_at)
         VALUES ($1, $2, 'owner', 'active', now())`,
        [space.id, userId],
      );

      if (input.type === 'COUPLE' && input.partnerUserId) {
        await client.query(
          `INSERT INTO space_memberships (space_id, user_id, role, state, joined_at)
           VALUES ($1, $2, 'member', 'active', now())`,
          [space.id, input.partnerUserId],
        );
      }

      await this.audit(client, space.id, userId, 'space.created', 'space', space.id);
      return {
        id: space.id,
        type: space.type,
        name: space.name,
        visibility: space.visibility,
        status: space.status,
        role: 'owner',
        createdAt: toIsoString(space.created_at),
      };
    });
  }

  async listMine(userId: string): Promise<SpaceSummary[]> {
    const result = await this.database.query<SpaceRow>(
      `SELECT s.id, s.type, s.name, s.visibility, s.status, sm.role, s.created_at
       FROM spaces s
       INNER JOIN space_memberships sm ON sm.space_id = s.id
       WHERE sm.user_id = $1 AND sm.state = 'active' AND s.status = 'active'
       ORDER BY s.created_at DESC, s.id DESC`,
      [userId],
    );
    return result.rows.map(toSummary);
  }

  async getMine(userId: string, spaceId: string): Promise<Record<string, unknown>> {
    const result = await this.database.query(
      `SELECT s.id, s.type, s.name, s.visibility, s.status, sm.role, s.created_at,
              ed.starts_at, ed.ends_at, ed.timezone, ed.moderation_mode, ed.download_policy,
              cd.anniversary_date, cd.settings AS couple_settings,
              cr.description, cr.join_policy
       FROM spaces s
       INNER JOIN space_memberships sm ON sm.space_id = s.id
       LEFT JOIN event_details ed ON ed.space_id = s.id
       LEFT JOIN couple_details cd ON cd.space_id = s.id
       LEFT JOIN circle_details cr ON cr.space_id = s.id
       WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
       LIMIT 1`,
      [spaceId, userId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('Space not found.');
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      visibility: row.visibility,
      status: row.status,
      role: row.role,
      createdAt: toIsoString(row.created_at as Date | string),
      details: row.type === 'EVENT'
        ? { startsAt: row.starts_at, endsAt: row.ends_at, timezone: row.timezone,
            moderationMode: row.moderation_mode, downloadPolicy: row.download_policy }
        : row.type === 'COUPLE'
          ? { anniversaryDate: row.anniversary_date, settings: row.couple_settings }
          : { description: row.description, joinPolicy: row.join_policy },
    };
  }

  async createInvitation(
    userId: string,
    spaceId: string,
    input: CreateInvitationInput,
  ): Promise<{ invitationId: string; token: string; expiresAt: string; maxUses: number }> {
    return this.database.transaction(async (client) => {
      const spaceResult = await client.query(
        `SELECT s.type, s.status, sm.role
         FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
         WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF s, sm`,
        [spaceId, userId],
      );
      const space = spaceResult.rows[0] as { type: SpaceType; status: string; role: string } | undefined;
      if (!space) throw new NotFoundException('Space not found.');
      if (space.status !== 'active') throw new ConflictException('This space is not active.');
      if (space.type === 'COUPLE') throw new ConflictException('Couple spaces do not support additional invitations.');
      if (space.role !== 'owner' && space.role !== 'admin') {
        throw new ForbiddenException('Only owners and admins can create invitations.');
      }
      if (input.role === 'admin' && space.role !== 'owner') {
        throw new ForbiddenException('Only the owner can invite another admin.');
      }

      const token = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const result = await client.query(
        `INSERT INTO space_invitations
           (space_id, created_by, token_hash, role, expires_at, max_uses)
         VALUES ($1, $2, $3, $4, now() + ($5::int * interval '1 hour'), $6)
         RETURNING id, expires_at`,
        [spaceId, userId, tokenHash, input.role, input.expiresInHours, input.maxUses],
      );
      const row = result.rows[0] as { id: string; expires_at: Date | string };
      await this.audit(client, spaceId, userId, 'space.invitation.created', 'invitation', row.id);
      return {
        invitationId: row.id,
        token,
        expiresAt: toIsoString(row.expires_at),
        maxUses: input.maxUses,
      };
    });
  }

  async acceptInvitation(userId: string, token: string): Promise<{ spaceId: string; role: string; alreadyMember: boolean }> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.database.transaction(async (client) => {
      const result = await client.query(
        `SELECT i.id, i.space_id, i.role, i.expires_at, i.max_uses, i.uses, i.revoked_at,
                s.type, s.status
         FROM space_invitations i JOIN spaces s ON s.id = i.space_id
         WHERE i.token_hash = $1
         FOR UPDATE OF i, s`,
        [tokenHash],
      );
      const invitation = result.rows[0] as (InvitationRow & { status: string }) | undefined;
      if (!invitation) throw new NotFoundException('Invitation is invalid.');
      if (invitation.revoked_at || new Date(invitation.expires_at).getTime() <= Date.now()) {
        throw new ConflictException('Invitation has expired or was revoked.');
      }
      if (invitation.uses >= invitation.max_uses) throw new ConflictException('Invitation has reached its usage limit.');
      if (invitation.status !== 'active') throw new ConflictException('The space is not active.');
      if (invitation.type === 'COUPLE') throw new ConflictException('Couple invitations are not supported.');

      const existing = await client.query(
        'SELECT state, role FROM space_memberships WHERE space_id = $1 AND user_id = $2 FOR UPDATE',
        [invitation.space_id, userId],
      );
      const existingMembership = existing.rows[0] as { state: string; role: string } | undefined;
      const currentState = existingMembership?.state;
      if (currentState === 'active') {
        return { spaceId: invitation.space_id, role: existingMembership.role, alreadyMember: true };
      }
      if (currentState === 'removed' || currentState === 'banned') {
        throw new ForbiddenException('This account cannot rejoin the space.');
      }

      if (currentState) {
        await client.query(
          `UPDATE space_memberships SET role = $3, state = 'active', joined_at = now(), left_at = NULL
           WHERE space_id = $1 AND user_id = $2`,
          [invitation.space_id, userId, invitation.role],
        );
      } else {
        await client.query(
          `INSERT INTO space_memberships (space_id, user_id, role, state, joined_at)
           VALUES ($1, $2, $3, 'active', now())`,
          [invitation.space_id, userId, invitation.role],
        );
      }
      await client.query(
        'UPDATE space_invitations SET uses = uses + 1 WHERE id = $1',
        [invitation.id],
      );
      await this.audit(client, invitation.space_id, userId, 'space.invitation.accepted', 'invitation', invitation.id);
      return { spaceId: invitation.space_id, role: invitation.role, alreadyMember: false };
    });
  }


  async listMembers(userId: string, spaceId: string) {
    const access = await this.database.query(
      `SELECT 1 FROM space_memberships
       WHERE space_id = $1 AND user_id = $2 AND state = 'active'
       LIMIT 1`,
      [spaceId, userId],
    );
    if (!access.rowCount) throw new NotFoundException('Space not found.');
    const result = await this.database.query(
      `SELECT sm.user_id, sm.role, sm.joined_at, up.display_name
       FROM space_memberships sm
       LEFT JOIN user_profiles up ON up.user_id = sm.user_id
       WHERE sm.space_id = $1 AND sm.state = 'active'
       ORDER BY CASE sm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1
         WHEN 'moderator' THEN 2 ELSE 3 END, sm.joined_at ASC, sm.user_id ASC`,
      [spaceId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      joinedAt: toIsoString(row.joined_at as Date | string),
    }));
  }

  async updateMemberRole(actorId: string, spaceId: string, memberId: string,
    role: 'admin' | 'moderator' | 'member' | 'guest'): Promise<void> {
    await this.database.transaction(async (client) => {
      const access = await client.query(
        `SELECT s.status, sm.role
         FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
         WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF s, sm`,
        [spaceId, actorId],
      );
      const actor = access.rows[0] as { status: string; role: string } | undefined;
      if (!actor) throw new NotFoundException('Space not found.');
      if (actor.status !== 'active') throw new ConflictException('The space is not active.');
      if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can change member roles.');

      const targetResult = await client.query(
        `SELECT role FROM space_memberships
         WHERE space_id = $1 AND user_id = $2 AND state = 'active'
         FOR UPDATE`,
        [spaceId, memberId],
      );
      const target = targetResult.rows[0] as { role: string } | undefined;
      if (!target) throw new NotFoundException('Active member not found.');
      if (target.role === 'owner') throw new ConflictException('The owner role cannot be changed here.');
      await client.query(
        'UPDATE space_memberships SET role = $3 WHERE space_id = $1 AND user_id = $2',
        [spaceId, memberId, role],
      );
      await this.audit(client, spaceId, actorId, 'space.member.role_changed', 'membership', memberId);
    });
  }

  async removeMember(actorId: string, spaceId: string, memberId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const access = await client.query(
        `SELECT s.type, s.status, sm.role
         FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
         WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF s, sm`,
        [spaceId, actorId],
      );
      const actor = access.rows[0] as { type: SpaceType; status: string; role: string } | undefined;
      if (!actor) throw new NotFoundException('Space not found.');
      if (actor.status !== 'active') throw new ConflictException('The space is not active.');
      if (actor.type === 'COUPLE') throw new ConflictException('Couple membership changes require the couple closure flow.');
      if (actor.role !== 'owner') throw new ForbiddenException('Only the owner can remove members.');

      const targetResult = await client.query(
        `SELECT role FROM space_memberships
         WHERE space_id = $1 AND user_id = $2 AND state = 'active'
         FOR UPDATE`,
        [spaceId, memberId],
      );
      const target = targetResult.rows[0] as { role: string } | undefined;
      if (!target) throw new NotFoundException('Active member not found.');
      if (target.role === 'owner') throw new ConflictException('The owner cannot be removed.');
      await client.query(
        `UPDATE space_memberships SET state = 'removed', left_at = now()
         WHERE space_id = $1 AND user_id = $2`,
        [spaceId, memberId],
      );
      await this.audit(client, spaceId, actorId, 'space.member.removed', 'membership', memberId);
    });
  }

  async leaveSpace(userId: string, spaceId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const result = await client.query(
        `SELECT s.type, s.status, sm.role
         FROM spaces s JOIN space_memberships sm ON sm.space_id = s.id
         WHERE s.id = $1 AND sm.user_id = $2 AND sm.state = 'active'
         FOR UPDATE OF s, sm`,
        [spaceId, userId],
      );
      const membership = result.rows[0] as { type: SpaceType; status: string; role: string } | undefined;
      if (!membership) throw new NotFoundException('Active membership not found.');
      if (membership.status !== 'active') throw new ConflictException('The space is not active.');
      if (membership.role === 'owner') throw new ConflictException('Transfer ownership or close the space before leaving.');
      if (membership.type === 'COUPLE') throw new ConflictException('Couple membership changes require the couple closure flow.');
      await client.query(
        `UPDATE space_memberships SET state = 'left', left_at = now()
         WHERE space_id = $1 AND user_id = $2`,
        [spaceId, userId],
      );
      await this.audit(client, spaceId, userId, 'space.member.left', 'membership', userId);
    });
  }

  private async audit(
    client: PoolClient,
    spaceId: string,
    actorId: string,
    action: string,
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
    await client.query(
      `INSERT INTO space_audit_events (space_id, actor_id, action, resource_type, resource_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [spaceId, actorId, action, resourceType, resourceId],
    );
  }
}

function toSummary(row: SpaceRow): SpaceSummary {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    visibility: row.visibility,
    status: row.status,
    role: row.role,
    createdAt: toIsoString(row.created_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
