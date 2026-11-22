import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = ['spotify', 'apple_music', 'youtube_music', 'external'];

@Injectable()
export class AudioService {
  constructor(private readonly db: DatabaseService) {}

  private async lockAuthorizationRead(client: { query: (sql: string, values?: unknown[]) => Promise<any> }) {
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
  }

  private id(value: string, label: string) {
    if (!UUID.test(value)) throw new BadRequestException(`Invalid ${label}.`);
  }

  private async assertAudioEntitlement(client: { query: (sql: string, values?: unknown[]) => Promise<any> }, userId: string) {
    const account=await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active'",[userId]);
    if(!account.rowCount) throw new ForbiddenException('An active account is required for Social Audio.');
    const entitlement=await client.query(
      `SELECT COALESCE(p.features->>'social_audio','true')::boolean AS enabled
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
    if(!entitlement.rowCount) throw new ConflictException('Subscription entitlements are unavailable.');
    if(entitlement.rows[0].enabled!==true) throw new ForbiddenException('Social Audio is not included in your current plan.');
  }

  private async assertSpaceMember(client: { query: (sql: string, values?: unknown[]) => Promise<any> }, userId: string, spaceId: string) {
    const r = await client.query(`SELECT s.id, sm.role FROM spaces s JOIN space_memberships sm ON sm.space_id=s.id
      WHERE s.id=$1 AND s.status='active' AND sm.user_id=$2 AND sm.state='active'`, [spaceId, userId]);
    if (!r.rowCount) throw new NotFoundException('Space not found.');
    return r.rows[0] as { id: string; role: string };
  }

  async createSession(userId: string, spaceId: string, sourceProvider: unknown) {
    this.id(spaceId, 'space id');
    const provider = sourceProvider === undefined ? 'external' : String(sourceProvider);
    if (!PROVIDERS.includes(provider)) throw new BadRequestException('Unsupported audio provider.');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const member = await this.assertSpaceMember(client, userId, spaceId);
      if (!['owner', 'admin', 'moderator'].includes(member.role)) throw new ForbiddenException('Only space moderators can start an audio session.');
      await client.query('SELECT id FROM spaces WHERE id=$1 FOR UPDATE', [spaceId]);
      const existing = await client.query(`SELECT id FROM audio_sessions WHERE space_id=$1 AND state IN ('created','playing','paused') LIMIT 1`, [spaceId]);
      if (existing.rowCount) throw new ConflictException('An audio session is already active in this space.');
      const result = await client.query(`INSERT INTO audio_sessions(space_id,host_user_id,source_provider,state,playback_state)
        VALUES($1,$2,$3,'created','paused')
        RETURNING id,space_id,host_user_id,state,source_provider,position_ms,playback_state,server_version,created_at,updated_at`, [spaceId,userId,provider]);
      const session = result.rows[0];
      await client.query(`INSERT INTO audio_participants(session_id,user_id,role,last_heartbeat_at)
        VALUES($1,$2,'host',now()) ON CONFLICT(session_id,user_id) WHERE device_id IS NULL
        DO UPDATE SET left_at=NULL,role='host',last_heartbeat_at=now()`, [session.id,userId]);
      return session;
    });
  }

  async getActiveSession(userId: string, spaceId: string) {
    this.id(spaceId, 'space id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      await this.assertSpaceMember(client,userId,spaceId);
      const r = await client.query(`SELECT id,space_id,host_user_id,state,source_provider,provider_context_id,current_item_id,position_ms,playback_state,scheduled_at,server_version,created_at,updated_at
        FROM audio_sessions WHERE space_id=$1 AND state IN ('created','playing','paused') ORDER BY created_at DESC LIMIT 1`, [spaceId]);
      if (!r.rowCount) return { session: null };
      return { session: await this.withQueue(r.rows[0],client) };
    });
  }

  async getSession(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const r = await client.query(`SELECT a.* FROM audio_sessions a JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id
        WHERE a.id=$1 AND sm.user_id=$2 AND sm.state='active'`, [sessionId,userId]);
      if (!r.rowCount) throw new NotFoundException('Audio session not found.');
      return this.withQueue(r.rows[0],client);
    });
  }

  private async withQueue(session: Record<string, any>, executor: { query: (sql: string, values?: unknown[]) => Promise<any> } = this.db): Promise<Record<string, any>> {
    const [queue, participants] = await Promise.all([
      executor.query(`SELECT q.id,q.added_by,q.provider_track_reference,q.position,q.state,q.created_at,
          COALESCE(v.upvotes,0)::int AS upvotes,
          COALESCE(v.downvotes,0)::int AS downvotes,
          (COALESCE(v.upvotes,0)-COALESCE(v.downvotes,0))::int AS vote_score
        FROM audio_queue_items q JOIN users queue_author ON queue_author.id=q.added_by AND queue_author.status='active'
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE vote=1) AS upvotes,
                 count(*) FILTER (WHERE vote=-1) AS downvotes
          FROM audio_votes av JOIN users vote_user ON vote_user.id=av.user_id AND vote_user.status='active' WHERE av.queue_item_id=q.id
        ) v ON true
        WHERE q.session_id=$1 AND q.state IN ('queued','current')
        ORDER BY (COALESCE(v.upvotes,0)-COALESCE(v.downvotes,0)) DESC,
                 q.position ASC,q.created_at ASC,q.id ASC`, [session.id]),
      executor.query(`SELECT p.user_id,p.role,p.joined_at,p.last_heartbeat_at,up.display_name FROM audio_participants p JOIN users participant_user ON participant_user.id=p.user_id AND participant_user.status='active'
        LEFT JOIN user_profiles up ON up.user_id=p.user_id WHERE p.session_id=$1 AND p.left_at IS NULL
        ORDER BY p.joined_at ASC`, [session.id]),
    ]);
    return { ...session, queue: queue.rows, participants: participants.rows };
  }

  async join(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const s = await client.query(`SELECT a.id,a.space_id,a.state FROM audio_sessions a
        JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$2 AND sm.state='active'
        WHERE a.id=$1 FOR UPDATE OF a`, [sessionId,userId]);
      if (!s.rowCount) throw new NotFoundException('Audio session not found.');
      if (s.rows[0].state === 'ended') throw new ConflictException('Audio session has ended.');
      await client.query(`INSERT INTO audio_participants(session_id,user_id,role,last_heartbeat_at)
        VALUES($1,$2,'listener',now()) ON CONFLICT(session_id,user_id) WHERE device_id IS NULL
        DO UPDATE SET left_at=NULL,last_heartbeat_at=now()`, [sessionId,userId]);
      await client.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
      return { joined: true, sessionId };
    });
  }

  async isActiveParticipant(userId: string, sessionId: string, staleAfterSeconds = 45): Promise<boolean> {
    this.id(sessionId,'session id');
    this.id(userId,'user id');
    const seconds=Number(staleAfterSeconds);
    if(!Number.isSafeInteger(seconds)||seconds<15||seconds>3600) throw new BadRequestException('Invalid stale participant timeout.');
    const result=await this.db.query(
      `SELECT 1 FROM audio_participants p
       JOIN audio_sessions a ON a.id=p.session_id AND a.state IN ('created','playing','paused')
       JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
       JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=p.user_id AND sm.state='active'
       JOIN users u ON u.id=p.user_id AND u.status='active'
       WHERE p.session_id=$1 AND p.user_id=$2 AND p.left_at IS NULL
         AND p.last_heartbeat_at>=now()-($3 * interval '1 second')`,
      [sessionId,userId,seconds],
    );
    return !!result.rowCount;
  }

  async cleanupStaleParticipants(staleAfterSeconds = 45): Promise<string[]> {
    const seconds = Number(staleAfterSeconds);
    if (!Number.isSafeInteger(seconds) || seconds < 15 || seconds > 3600) {
      throw new BadRequestException('Invalid stale participant timeout.');
    }
    return this.db.transaction(async client => {
      const result = await client.query<{ id: string }>(`WITH stale AS (
          UPDATE audio_participants p SET left_at=now()
          FROM audio_sessions s
          WHERE p.session_id=s.id AND p.left_at IS NULL
            AND p.last_heartbeat_at < now() - ($1 * interval '1 second')
            AND s.state IN ('created','playing','paused')
          RETURNING p.session_id,p.user_id,p.role
        ), affected AS (
          SELECT DISTINCT session_id FROM stale
        ), host_lost AS (
          SELECT DISTINCT session_id FROM stale WHERE role='host'
        ), no_listeners AS (
          SELECT a.id AS session_id
          FROM audio_sessions a JOIN affected x ON x.session_id=a.id
          WHERE NOT EXISTS (
            SELECT 1 FROM audio_participants p
            WHERE p.session_id=a.id AND p.left_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM stale st WHERE st.session_id=p.session_id AND st.user_id=p.user_id)
          )
        ), ended AS (
          UPDATE audio_sessions a
          SET state='ended',playback_state='ended',position_ms=0,current_item_id=NULL,
              updated_at=now(),server_version=server_version+1
          WHERE a.id IN (SELECT session_id FROM host_lost UNION SELECT session_id FROM no_listeners)
            AND a.state IN ('created','playing','paused')
          RETURNING a.id
        ), updated AS (
          UPDATE audio_sessions a
          SET server_version=server_version+1,updated_at=now()
          FROM affected x
          WHERE a.id=x.session_id
            AND a.state IN ('created','playing','paused')
            AND a.id NOT IN (SELECT id FROM ended)
          RETURNING a.id
        )
        SELECT id FROM ended
        UNION SELECT id FROM updated`, [seconds]);
      await client.query(`UPDATE audio_queue_items SET state='played'
        WHERE session_id IN (SELECT id FROM audio_sessions WHERE state='ended')
          AND state IN ('queued','current')`);
      return result.rows.map(row => row.id);
    });
  }

  async heartbeat(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const r = await client.query(`UPDATE audio_participants p
        SET last_heartbeat_at=now()
        FROM audio_sessions s
        JOIN spaces sp ON sp.id=s.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=s.space_id AND sm.user_id=$2 AND sm.state='active'
        WHERE p.session_id=s.id AND p.session_id=$1 AND p.user_id=$2
          AND p.left_at IS NULL AND s.state IN ('created','playing','paused')
        RETURNING p.session_id,p.last_heartbeat_at`, [sessionId,userId]);
      if (!r.rowCount) throw new NotFoundException('Active audio participation not found.');
      return { sessionId: r.rows[0].session_id, heartbeatAt: r.rows[0].last_heartbeat_at };
    });
  }

  async leave(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const participation = await client.query(
        `SELECT p.id,p.role,a.state
         FROM audio_participants p
         JOIN audio_sessions a ON a.id=p.session_id
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$2 AND sm.state='active'
         WHERE p.session_id=$1 AND p.user_id=$2 AND p.left_at IS NULL
         FOR UPDATE OF p,a`,
        [sessionId,userId],
      );
      if (!participation.rowCount) throw new NotFoundException('Active audio participation not found.');
      const role = String(participation.rows[0].role);
      await client.query(
        `UPDATE audio_participants SET left_at=now() WHERE id=$1`,
        [participation.rows[0].id],
      );
      if (role === 'host') {
        await client.query(
          `UPDATE audio_sessions
           SET state='ended',playback_state='ended',position_ms=0,current_item_id=NULL,
               server_version=server_version+1,updated_at=now()
           WHERE id=$1 AND state IN ('created','playing','paused')`,
          [sessionId],
        );
        await client.query(
          `UPDATE audio_queue_items SET state='played'
           WHERE session_id=$1 AND state IN ('queued','current')`,
          [sessionId],
        );
        return { left: true, sessionEnded: true, reason: 'HOST_LEFT' };
      }
      await client.query(
        `UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`,
        [sessionId],
      );
      return { left: true, sessionEnded: false };
    });
  }

  async addQueueItem(userId: string, sessionId: string, trackReference: unknown) {
    this.id(sessionId, 'session id');
    if (typeof trackReference !== 'string' || !trackReference.trim() || trackReference.length > 500) throw new BadRequestException('A valid provider track reference is required.');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const s = await client.query(`SELECT a.id FROM audio_sessions a
        JOIN audio_participants p ON p.session_id=a.id
        JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$2 AND sm.state='active'
        WHERE a.id=$1 AND p.user_id=$2 AND p.left_at IS NULL AND a.state IN ('created','playing','paused')
        FOR UPDATE OF a`, [sessionId,userId]);
      if (!s.rowCount) throw new NotFoundException('Active audio participation not found.');
      const pos = await client.query(`SELECT COALESCE(MAX(position),-1)+1 AS next_position FROM audio_queue_items WHERE session_id=$1`, [sessionId]);
      const r = await client.query(`INSERT INTO audio_queue_items(session_id,added_by,provider_track_reference,position)
        VALUES($1,$2,$3,$4) RETURNING id,session_id,added_by,provider_track_reference,position,state,created_at`,
        [sessionId,userId,trackReference.trim(),pos.rows[0].next_position]);
      await client.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
      return r.rows[0];
    });
  }

  async removeQueueItem(userId: string, sessionId: string, itemId: string) {
    this.id(sessionId, 'session id'); this.id(itemId, 'queue item id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const r = await client.query(`UPDATE audio_queue_items q SET state='removed' FROM audio_sessions a
        JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$3 AND sm.state='active'
        WHERE q.id=$1 AND q.session_id=$2 AND a.id=q.session_id AND a.host_user_id=$3
        AND q.state IN ('queued','current') RETURNING q.id`, [itemId,sessionId,userId]);
      if (!r.rowCount) throw new NotFoundException('Queue item not found.');
      await client.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
      return { removed: true };
    });
  }

  async updatePlayback(userId: string, sessionId: string, input: { action?: unknown; positionMs?: unknown; currentItemId?: unknown; expectedVersion?: unknown }) {
    this.id(sessionId, 'session id');
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['action','positionMs','currentItemId','expectedVersion'].includes(key))) {
      throw new BadRequestException('Invalid playback command fields.');
    }
    const action = String(input.action ?? '');
    if (!['play','pause','seek','next','end'].includes(action)) throw new BadRequestException('Invalid playback action.');
    if (input.positionMs !== undefined && action !== 'seek') throw new BadRequestException('positionMs is only valid for seek.');
    if (input.currentItemId !== undefined && !['play','next'].includes(action)) throw new BadRequestException('currentItemId is only valid for play or next.');
    const position = input.positionMs === undefined ? 0 : Number(input.positionMs);
    if (!Number.isSafeInteger(position) || position < 0 || position > 86400000) throw new BadRequestException('Invalid playback position.');
    if (input.expectedVersion !== undefined && (!Number.isSafeInteger(Number(input.expectedVersion)) || Number(input.expectedVersion) < 1)) throw new BadRequestException('Invalid expected version.');
    let itemId = input.currentItemId ?? null;
    if (itemId !== null) this.id(String(itemId), 'queue item id');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const s = await client.query(`SELECT a.id,a.host_user_id,a.state,a.server_version FROM audio_sessions a
        JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$2 AND sm.state='active'
        WHERE a.id=$1 FOR UPDATE OF a`, [sessionId,userId]);
      if (!s.rowCount) throw new NotFoundException('Audio session not found.');
      if (s.rows[0].state === 'ended') throw new ConflictException('Audio session has ended.');
      if (s.rows[0].host_user_id !== userId) throw new ForbiddenException('Only the host can control playback.');
      if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(s.rows[0].server_version)) throw new ConflictException('Playback state changed; refresh and retry.');
      if (action === 'next' && itemId === null) {
        const next = await client.query(`SELECT q.id FROM audio_queue_items q
          LEFT JOIN LATERAL (
            SELECT count(*) FILTER (WHERE vote=1) AS upvotes,
                   count(*) FILTER (WHERE vote=-1) AS downvotes
            FROM audio_votes WHERE queue_item_id=q.id
          ) v ON true
          WHERE q.session_id=$1 AND q.state='queued'
          ORDER BY (COALESCE(v.upvotes,0)-COALESCE(v.downvotes,0)) DESC,
                   q.position ASC,q.created_at ASC,q.id ASC
          LIMIT 1 FOR UPDATE OF q`, [sessionId]);
        itemId = next.rowCount ? next.rows[0].id : null;
      }
      if (itemId !== null) {
        const item = await client.query(`SELECT id FROM audio_queue_items WHERE id=$1 AND session_id=$2 AND state IN ('queued','current')`, [itemId,sessionId]);
        if (!item.rowCount) throw new NotFoundException('Queue item not found.');
      }
      const state = action === 'end' ? 'ended' : action === 'play' || (action === 'next' && itemId !== null) ? 'playing' : action === 'pause' ? 'paused' : action === 'next' && itemId === null ? 'ended' : undefined;
      const playback = action === 'end' ? 'ended' : action === 'play' || (action === 'next' && itemId !== null) ? 'playing' : action === 'pause' ? 'paused' : action === 'next' && itemId === null ? 'ended' : undefined;
      const resetPosition = action === 'next' || action === 'end';
      const clearCurrentItem = action === 'end' || (action === 'next' && itemId === null);
      const r = await client.query(`UPDATE audio_sessions SET
        state=COALESCE($2,state),playback_state=COALESCE($3,playback_state),
        position_ms=CASE WHEN $4 THEN $5 WHEN $8 THEN 0 ELSE position_ms END,
        current_item_id=CASE WHEN $7 THEN $6 ELSE COALESCE($6,current_item_id) END,
        server_version=server_version+1,updated_at=now()
        WHERE id=$1 RETURNING id,state,playback_state,position_ms,current_item_id,server_version,updated_at`,
        [sessionId,state ?? null,playback ?? null,action==='seek',position,itemId,clearCurrentItem,resetPosition]);
      if (itemId !== null) await client.query(`UPDATE audio_queue_items SET state=CASE WHEN id=$1 THEN 'current' WHEN state='current' THEN 'played' ELSE state END WHERE session_id=$2 AND state IN ('queued','current')`, [itemId,sessionId]);
      if (action === 'end' || (action === 'next' && itemId === null)) await client.query(`UPDATE audio_queue_items SET state='played' WHERE session_id=$1 AND state IN ('queued','current')`, [sessionId]);
      return r.rows[0];
    });
  }

  async vote(userId: string, sessionId: string, itemId: string, vote: unknown) {
    this.id(sessionId, 'session id'); this.id(itemId, 'queue item id');
    const value = Number(vote);
    if (value !== -1 && value !== 1) throw new BadRequestException('Vote must be -1 or 1.');
    return this.db.transaction(async client => {
      await this.lockAuthorizationRead(client);
      await this.assertAudioEntitlement(client,userId);
      const allowed = await client.query(`SELECT 1 FROM audio_queue_items q
        JOIN audio_participants p ON p.session_id=q.session_id
        JOIN audio_sessions a ON a.id=q.session_id
        JOIN spaces sp ON sp.id=a.space_id AND sp.status='active'
        JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$3 AND sm.state='active'
        WHERE q.id=$1 AND q.session_id=$2 AND p.user_id=$3 AND p.left_at IS NULL AND q.state='queued'`, [itemId,sessionId,userId]);
      if (!allowed.rowCount) throw new NotFoundException('Queue item or active participant not found.');
      const r = await client.query(`INSERT INTO audio_votes(queue_item_id,user_id,vote) VALUES($1,$2,$3)
        ON CONFLICT(queue_item_id,user_id) DO UPDATE SET vote=EXCLUDED.vote RETURNING queue_item_id,vote`, [itemId,userId,value]);
      await client.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
      return r.rows[0];
    });
  }
}
