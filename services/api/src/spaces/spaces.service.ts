import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type SpaceType = 'EVENT' | 'COUPLE' | 'CIRCLE';
export type SpaceVisibility = 'private' | 'unlisted' | 'public';

export interface CreateSpaceInput {
  type: SpaceType;
  name: string;
  visibility: SpaceVisibility;
  timezone?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  description?: string | null;
  partnerUserId?: string;
}

@Injectable()
export class SpacesService {
  constructor(private readonly database: DatabaseService) {}

  async listMine(userId: string) {
    const result = await this.database.query(
      `SELECT s.id, s.type, s.name, s.visibility, s.status, s.owner_id,
              s.created_at, sm.role, sm.joined_at,
              (SELECT count(*)::int FROM space_memberships active
               WHERE active.space_id = s.id AND active.state = 'active') AS member_count
       FROM space_memberships sm
       JOIN spaces s ON s.id = sm.space_id
       WHERE sm.user_id = $1 AND sm.state = 'active' AND s.status = 'active'
       ORDER BY s.updated_at DESC, s.created_at DESC
       LIMIT 100`,
      [userId],
    );
    return result.rows;
  }

  async create(userId: string, input: CreateSpaceInput) {
    if (input.type === 'COUPLE') {
      throw new BadRequestException('Couple spaces will be enabled with the consent-based invitation and acceptance flow.');
    }
    return this.database.transaction(async (client) => {
      if (input.type === 'COUPLE') {
        if (!input.partnerUserId || input.partnerUserId === userId) {
          throw new BadRequestException('A different active partner account is required for a couple space.');
        }
        const partner = await client.query(
          `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR SHARE`,
          [input.partnerUserId],
        );
        if (!partner.rowCount) throw new BadRequestException('The partner account does not exist or is not active.');
      }

      const created = await client.query(
        `INSERT INTO spaces (type, owner_id, name, visibility)
         VALUES ($1, $2, $3, $4)
         RETURNING id, type, name, visibility, status, owner_id, created_at`,
        [input.type, userId, input.name, input.visibility],
      );
      const space = created.rows[0] as Record<string, unknown>;
      const spaceId = String(space.id);

      await client.query(
        `INSERT INTO space_memberships (space_id, user_id, role, state, joined_at)
         VALUES ($1, $2, 'owner', 'active', now())`,
        [spaceId, userId],
      );

      if (input.type === 'EVENT') {
        await client.query(
          `INSERT INTO event_details (space_id, starts_at, ends_at, timezone)
           VALUES ($1, $2, $3, $4)`,
          [spaceId, input.startsAt ?? null, input.endsAt ?? null, input.timezone ?? 'UTC'],
        );
      } else if (input.type === 'CIRCLE') {
        await client.query(
          `INSERT INTO circle_details (space_id, description, join_policy)
           VALUES ($1, $2, 'invite')`,
          [spaceId, input.description ?? null],
        );
      }
      return { ...space, memberCount: input.type === 'COUPLE' ? 2 : 1 };
    });
  }

  async getMine(userId: string, spaceId: string) {
    const result = await this.database.query(
      `SELECT s.id, s.type, s.name, s.visibility, s.status, s.owner_id,
              s.settings, s.created_at, s.updated_at, sm.role,
              ed.starts_at, ed.ends_at, ed.timezone, ed.moderation_mode, ed.download_policy,
              cd.anniversary_date,
              cir.description, cir.join_policy
       FROM spaces s
       JOIN space_memberships sm ON sm.space_id = s.id
         AND sm.user_id = $1 AND sm.state = 'active'
       LEFT JOIN event_details ed ON ed.space_id = s.id
       LEFT JOIN couple_details cd ON cd.space_id = s.id
       LEFT JOIN circle_details cir ON cir.space_id = s.id
       WHERE s.id = $2 AND s.status = 'active'
       LIMIT 1`,
      [userId, spaceId],
    );
    if (!result.rowCount) {
      // Do not reveal whether an inaccessible space exists.
      throw new NotFoundException('Space was not found.');
    }
    return result.rows[0];
  }

  validateCreateInput(value: unknown): CreateSpaceInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('A space object is required.');
    }
    const body = value as Record<string, unknown>;
    const allowed = ['type','name','visibility','timezone','startsAt','endsAt','description','partnerUserId'];
    if (Object.keys(body).some((key) => !allowed.includes(key))) {
      throw new BadRequestException('The space contains unsupported fields.');
    }
    if (body.type !== 'EVENT' && body.type !== 'COUPLE' && body.type !== 'CIRCLE') {
      throw new BadRequestException('type must be EVENT, COUPLE or CIRCLE.');
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) throw new BadRequestException('name must contain between 1 and 120 characters.');
    const visibility = body.visibility ?? 'private';
    if (visibility !== 'private' && visibility !== 'unlisted' && visibility !== 'public') {
      throw new BadRequestException('visibility must be private, unlisted or public.');
    }
    const optionalString = (key: string, max: number): string | null | undefined => {
      const v = body[key];
      if (v === undefined) return undefined;
      if (v === null) return null;
      if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`${key} is invalid.`);
      return v;
    };
    const timezone = optionalString('timezone', 80);
    const startsAt = optionalString('startsAt', 40);
    const endsAt = optionalString('endsAt', 40);
    const description = optionalString('description', 500);
    const partnerUserId = optionalString('partnerUserId', 36);
    if (timezone === null || partnerUserId === null) {
      throw new BadRequestException('timezone and partnerUserId cannot be null.');
    }
    if (body.type === 'COUPLE' && !partnerUserId) {
      throw new BadRequestException('partnerUserId is required for a couple space.');
    }
    if (body.type !== 'COUPLE' && partnerUserId) {
      throw new BadRequestException('partnerUserId is only valid for couple spaces.');
    }
    if (body.type === 'EVENT') {
      for (const [key, v] of [['startsAt', startsAt], ['endsAt', endsAt]] as const) {
        if (v != null && (typeof v !== 'string' || Number.isNaN(Date.parse(v)))) {
          throw new BadRequestException(`${key} must be a valid ISO date-time.`);
        }
      }
      if (startsAt && endsAt && Date.parse(endsAt) < Date.parse(startsAt)) {
        throw new BadRequestException('endsAt cannot be earlier than startsAt.');
      }
    }
    return {
      type: body.type,
      name,
      visibility,
      ...(timezone !== undefined ? { timezone } : {}),
      ...(startsAt !== undefined ? { startsAt } : {}),
      ...(endsAt !== undefined ? { endsAt } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(partnerUserId !== undefined ? { partnerUserId } : {}),
    };
  }
}
