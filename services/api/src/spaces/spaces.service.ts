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
  joinPolicy?: 'invite' | 'approval';
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
       WHERE sm.user_id = $1 AND sm.state = 'active' AND s.status IN ('active','archived')
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
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':space-quota']);
      const limits=await client.query(
        `SELECT COALESCE((p.features->>'max_spaces')::integer,5) max_spaces
         FROM subscription_plans p
         LEFT JOIN LATERAL (
           SELECT us.plan_id FROM user_subscriptions us
           WHERE us.user_id=$1 AND us.status IN ('trialing','active','past_due')
             AND (us.current_period_end IS NULL OR us.current_period_end>now())
           ORDER BY CASE us.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
                    us.created_at DESC LIMIT 1
         ) s ON s.plan_id=p.id
         WHERE p.id=COALESCE(s.plan_id,(SELECT id FROM subscription_plans WHERE code='free'))`,
        [userId],
      );
      const count=await client.query(
        `SELECT count(*)::integer total FROM spaces
         WHERE owner_id=$1 AND status IN ('active','archived')`,[userId],
      );
      if(!limits.rowCount || Number(count.rows[0].total)>=Number(limits.rows[0].max_spaces)) {
        throw new BadRequestException('Your plan space limit has been reached. Upgrade your plan or close an existing space.');
      }
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
           VALUES ($1, $2, $3)`,
          [spaceId, input.description ?? null, input.joinPolicy ?? 'invite'],
        );
      }
      return { ...space, memberCount: input.type === 'COUPLE' ? 2 : 1 };
    });
  }

  async updateEvent(userId: string, spaceId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Event update data is required.');
    }
    const body=input as Record<string,unknown>;
    const allowed=['name','startsAt','endsAt','timezone','moderationMode','downloadPolicy'];
    if(Object.keys(body).length===0 || Object.keys(body).some(key=>!allowed.includes(key))) {
      throw new BadRequestException('Event update contains no supported fields or unsupported fields.');
    }
    if(body.name!==undefined && (typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>120)) {
      throw new BadRequestException('Event name must contain 1 to 120 characters.');
    }
    for(const key of ['startsAt','endsAt','timezone'] as const) {
      const value=body[key];
      if(value!==undefined && value!==null && (typeof value!=='string' ||
        (key==='timezone' ? value.length>80 : Number.isNaN(Date.parse(value))))) {
        throw new BadRequestException(`${key} is invalid.`);
      }
    }
    if(body.timezone===null) throw new BadRequestException('timezone cannot be null.');
    if(body.startsAt!==undefined && body.endsAt!==undefined && body.startsAt!==null && body.endsAt!==null && Date.parse(String(body.endsAt))<Date.parse(String(body.startsAt))) {
      throw new BadRequestException('endsAt cannot be earlier than startsAt.');
    }
    if(body.moderationMode!==undefined && !['host','approval','community'].includes(String(body.moderationMode))) {
      throw new BadRequestException('moderationMode is invalid.');
    }
    if(body.downloadPolicy!==undefined && !['host_only','members','disabled'].includes(String(body.downloadPolicy))) {
      throw new BadRequestException('downloadPolicy is invalid.');
    }
    return this.database.transaction(async client=>{
      const access=await client.query(
        `SELECT s.id,s.name,ed.starts_at,ed.ends_at,ed.timezone,ed.moderation_mode,ed.download_policy
         FROM spaces s JOIN event_details ed ON ed.space_id=s.id
         JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$1 AND sm.state='active'
         WHERE s.id=$2 AND s.type='EVENT' AND s.status='active'
           AND sm.role IN ('owner','admin')
         FOR UPDATE OF s,ed`,
        [userId,spaceId]);
      if(!access.rowCount) throw new NotFoundException('Event not found.');
      const current=access.rows[0] as Record<string,unknown>;
      const start=body.startsAt===undefined?current.starts_at:body.startsAt;
      const end=body.endsAt===undefined?current.ends_at:body.endsAt;
      if(start!==null && end!==null && Date.parse(String(end))<Date.parse(String(start))) {
        throw new BadRequestException('endsAt cannot be earlier than startsAt.');
      }
      const updated=await client.query(
        `UPDATE event_details SET starts_at=$2,ends_at=$3,timezone=$4,
           moderation_mode=$5,download_policy=$6
         WHERE space_id=$1
         RETURNING starts_at,ends_at,timezone,moderation_mode,download_policy`,
        [spaceId,start,end,body.timezone??current.timezone,
         body.moderationMode??current.moderation_mode,body.downloadPolicy??current.download_policy]);
      const name=body.name===undefined?current.name:String(body.name).trim();
      if(name!==current.name) await client.query(`UPDATE spaces SET name=$2 WHERE id=$1`,[spaceId,name]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,'event.updated','space',$1,$3::jsonb)`,
        [spaceId,userId,JSON.stringify({fields:Object.keys(body)})]);
      return {spaceId,name,...updated.rows[0]};
    });
  }

  async changeLifecycle(userId:string,spaceId:string,action:unknown) {
    if(action!=='archive'&&action!=='reopen'&&action!=='close') {
      throw new BadRequestException('action must be archive, reopen or close.');
    }
    return this.database.transaction(async client=>{
      const current=await client.query(
        `SELECT s.id,s.type,s.status FROM spaces s
         JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$1
           AND sm.state='active' AND sm.role='owner'
         WHERE s.id=$2 FOR UPDATE OF s`,[userId,spaceId]);
      if(!current.rowCount) throw new NotFoundException('Space not found or owner permission required.');
      const row=current.rows[0] as Record<string,unknown>;
      const status=String(row.status);
      if(action==='archive'&&status!=='active') throw new BadRequestException('Only an active space can be archived.');
      if(action==='reopen'&&status!=='archived') throw new BadRequestException('Only an archived space can be reopened.');
      if(action==='close'&&status!=='active'&&status!=='archived') throw new BadRequestException('This space cannot be closed.');
      const next=action==='archive'?'archived':action==='reopen'?'active':'closed';
      const updated=await client.query(
        `UPDATE spaces SET status=$2,closed_at=CASE WHEN $2='closed' THEN now() ELSE NULL END
         WHERE id=$1 RETURNING id,type,status,closed_at,updated_at`,[spaceId,next]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,$3,'space',$1,jsonb_build_object('previousStatus',$4,'newStatus',$5))`,
        [spaceId,userId,`space.${action}`,status,next]);
      return updated.rows[0];
    });
  }


  async archiveEndedEvents(graceHours = 24) {
    const grace = Math.min(Math.max(Number(graceHours) || 24, 1), 168);
    return this.database.transaction(async client => {
      const candidates = await client.query(
        `WITH ended AS (
           SELECT s.id FROM spaces s
           JOIN event_details ed ON ed.space_id=s.id
           WHERE s.type='EVENT' AND s.status='active'
             AND ed.ends_at IS NOT NULL
             AND ed.ends_at < now()-($1::int * interval '1 hour')
           ORDER BY ed.ends_at
           LIMIT 100
           FOR UPDATE OF s SKIP LOCKED
         )
         UPDATE spaces s SET status='archived',updated_at=now()
         FROM ended e WHERE s.id=e.id
         RETURNING s.id,s.owner_id,s.status`,
        [grace],
      );
      for (const event of candidates.rows) {
        await client.query(
          `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
           VALUES($1,$2,'event.auto_archived','space',$1,jsonb_build_object('graceHours',$3))`,
          [event.id,event.owner_id,grace],
        );
      }
      return { archived: candidates.rowCount ?? 0, eventIds: candidates.rows.map(row => row.id) };
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
       WHERE s.id = $2 AND s.status IN ('active','archived')
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
    const allowed = ['type','name','visibility','timezone','startsAt','endsAt','description','joinPolicy','partnerUserId'];
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
    const joinPolicy = body.joinPolicy ?? 'invite';
    if (joinPolicy !== 'invite' && joinPolicy !== 'approval') throw new BadRequestException('joinPolicy must be invite or approval.');
    if (body.type !== 'CIRCLE' && body.joinPolicy !== undefined) throw new BadRequestException('joinPolicy is only valid for circles.');
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
      ...(body.type === 'CIRCLE' ? { joinPolicy } : {}),
      ...(partnerUserId !== undefined ? { partnerUserId } : {}),
    };
  }
}
