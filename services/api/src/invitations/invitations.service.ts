import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

export interface CreateInvitationInput {
  role: 'member' | 'guest';
  expiresInDays: number;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly database: DatabaseService) {}

  validateCreateInput(value: unknown): CreateInvitationInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('An invitation object is required.');
    }
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['role', 'expiresInDays'].includes(key))) {
      throw new BadRequestException('The invitation contains unsupported fields.');
    }
    const role = body.role ?? 'member';
    if (role !== 'member' && role !== 'guest') {
      throw new BadRequestException('Invitations can only grant member or guest access.');
    }
    const expiresInDays = body.expiresInDays ?? 7;
    if (!Number.isInteger(expiresInDays) || Number(expiresInDays) < 1 || Number(expiresInDays) > 30) {
      throw new BadRequestException('expiresInDays must be an integer between 1 and 30.');
    }
    return { role, expiresInDays: Number(expiresInDays) };
  }

  async create(userId: string, spaceId: string, input: CreateInvitationInput) {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await this.database.query(
      `INSERT INTO space_invitations
         (space_id, created_by, token_hash, role, expires_at, max_uses, approval_required)
       SELECT s.id, $1, $3, $4, now() + ($5::int * interval '1 day'), 1, false
       FROM spaces s
       JOIN space_memberships sm ON sm.space_id = s.id
         AND sm.user_id = $1 AND sm.state = 'active'
         AND sm.role IN ('owner','admin')
       WHERE s.id = $2 AND s.status = 'active' AND s.type IN ('EVENT','CIRCLE')
       RETURNING id, space_id, role, expires_at, max_uses, created_at`,
      [userId, spaceId, tokenHash, input.role, input.expiresInDays],
    );
    if (!result.rowCount) {
      // Avoid disclosing whether the space exists or whether the caller is a member.
      throw new NotFoundException('Space was not found or invitation permission is missing.');
    }
    return { ...result.rows[0], token };
  }

  async list(userId: string, spaceId: string) {
    const result = await this.database.query(
      `SELECT i.id, i.space_id, i.role, i.expires_at, i.max_uses, i.uses,
              i.revoked_at, i.created_at
       FROM space_invitations i
       JOIN space_memberships sm ON sm.space_id = i.space_id
         AND sm.user_id = $1 AND sm.state = 'active'
         AND sm.role IN ('owner','admin')
       WHERE i.space_id = $2
       ORDER BY i.created_at DESC LIMIT 100`,
      [userId, spaceId],
    );
    return result.rows;
  }

  async revoke(userId: string, spaceId: string, invitationId: string) {
    const result = await this.database.query(
      `UPDATE space_invitations i SET revoked_at = now()
       WHERE i.id = $3 AND i.space_id = $2 AND i.revoked_at IS NULL
         AND i.expires_at > now()
         AND EXISTS (
           SELECT 1 FROM space_memberships sm
           WHERE sm.space_id = i.space_id AND sm.user_id = $1
             AND sm.state = 'active' AND sm.role IN ('owner','admin')
         )
       RETURNING i.id, i.space_id, i.revoked_at`,
      [userId, spaceId, invitationId],
    );
    if (!result.rowCount) throw new NotFoundException('Invitation was not found or cannot be revoked.');
    return result.rows[0];
  }

  async accept(userId: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new BadRequestException('The invitation token is invalid.');
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.database.transaction(async (client) => {
      const invitation = await client.query(
        `SELECT i.id, i.space_id, i.role, i.expires_at, i.max_uses, i.uses,
                i.approval_required, s.type, s.status
         FROM space_invitations i
         JOIN spaces s ON s.id = i.space_id
         WHERE i.token_hash = $1
         FOR UPDATE OF i`,
        [tokenHash],
      );
      if (!invitation.rowCount) throw new NotFoundException('Invitation is invalid or unavailable.');
      const invite = invitation.rows[0] as Record<string, unknown>;
      if (invite.status !== 'active' || invite.revoked_at ||
          new Date(String(invite.expires_at)).getTime() <= Date.now() ||
          Number(invite.uses) >= Number(invite.max_uses)) {
        throw new NotFoundException('Invitation is invalid or unavailable.');
      }
      if (invite.type === 'COUPLE') {
        throw new BadRequestException('Couple invitations require the dedicated mutual-consent flow.');
      }
      const existing = await client.query(
        `SELECT state FROM space_memberships WHERE space_id = $1 AND user_id = $2 FOR UPDATE`,
        [invite.space_id, userId],
      );
      if (existing.rowCount && existing.rows[0].state === 'active') {
        throw new BadRequestException('You are already an active member of this space.');
      }
      if (invite.approval_required) {
        throw new BadRequestException('This invitation requires approval and cannot yet be accepted directly.');
      }
      if (existing.rowCount) {
        await client.query(
          `UPDATE space_memberships SET role = $3, state = 'active', joined_at = now(), left_at = NULL
           WHERE space_id = $1 AND user_id = $2`,
          [invite.space_id, userId, invite.role],
        );
      } else {
        await client.query(
          `INSERT INTO space_memberships (space_id, user_id, role, state, joined_at)
           VALUES ($1, $2, $3, 'active', now())`,
          [invite.space_id, userId, invite.role],
        );
      }
      await client.query(
        `UPDATE space_invitations SET uses = uses + 1 WHERE id = $1`,
        [invite.id],
      );
      return { spaceId: invite.space_id, role: invite.role, membership: 'active' };
    });
  }
}
