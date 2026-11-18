import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDERS = ['spotify', 'apple_music', 'youtube_music', 'external'];

@Injectable()
export class AudioService {
  constructor(private readonly db: DatabaseService) {}

  private id(value: string, label: string) {
    if (!UUID.test(value)) throw new BadRequestException(`Invalid ${label}.`);
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
    await this.assertSpaceMember(this.db, userId, spaceId);
    const r = await this.db.query(`SELECT id,space_id,host_user_id,state,source_provider,provider_context_id,current_item_id,position_ms,playback_state,scheduled_at,server_version,created_at,updated_at
      FROM audio_sessions WHERE space_id=$1 AND state IN ('created','playing','paused') ORDER BY created_at DESC LIMIT 1`, [spaceId]);
    if (!r.rowCount) return { session: null };
    return { session: await this.withQueue(r.rows[0]) };
  }

  async getSession(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    const r = await this.db.query(`SELECT a.* FROM audio_sessions a JOIN space_memberships sm ON sm.space_id=a.space_id
      WHERE a.id=$1 AND sm.user_id=$2 AND sm.state='active'`, [sessionId,userId]);
    if (!r.rowCount) throw new NotFoundException('Audio session not found.');
    return this.withQueue(r.rows[0]);
  }

  private async withQueue(session: Record<string, any>) {
    const [queue, participants] = await Promise.all([
      this.db.query(`SELECT id,added_by,provider_track_reference,position,state,created_at FROM audio_queue_items
        WHERE session_id=$1 AND state IN ('queued','current') ORDER BY position ASC`, [session.id]),
      this.db.query(`SELECT p.user_id,p.role,p.joined_at,p.last_heartbeat_at,up.display_name FROM audio_participants p
        LEFT JOIN user_profiles up ON up.user_id=p.user_id WHERE p.session_id=$1 AND p.left_at IS NULL
        ORDER BY p.joined_at ASC`, [session.id]),
    ]);
    return { ...session, queue: queue.rows, participants: participants.rows };
  }

  async join(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    return this.db.transaction(async client => {
      const s = await client.query(`SELECT a.id,a.space_id,a.state FROM audio_sessions a
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

  async heartbeat(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    const r = await this.db.query(`UPDATE audio_participants p
      SET last_heartbeat_at=now()
      FROM audio_sessions s
      JOIN space_memberships sm ON sm.space_id=s.space_id AND sm.user_id=$2 AND sm.state='active'
      WHERE p.session_id=s.id AND p.session_id=$1 AND p.user_id=$2
        AND p.left_at IS NULL AND s.state IN ('created','playing','paused')
      RETURNING p.session_id,p.last_heartbeat_at`, [sessionId,userId]);
    if (!r.rowCount) throw new NotFoundException('Active audio participation not found.');
    return { sessionId: r.rows[0].session_id, heartbeatAt: r.rows[0].last_heartbeat_at };
  }

  async leave(userId: string, sessionId: string) {
    this.id(sessionId, 'session id');
    const r = await this.db.query(`UPDATE audio_participants SET left_at=now()
      WHERE session_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING id`, [sessionId,userId]);
    if (!r.rowCount) throw new NotFoundException('Active audio participation not found.');
    await this.db.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
    return { left: true };
  }

  async addQueueItem(userId: string, sessionId: string, trackReference: unknown) {
    this.id(sessionId, 'session id');
    if (typeof trackReference !== 'string' || !trackReference.trim() || trackReference.length > 500) throw new BadRequestException('A valid provider track reference is required.');
    return this.db.transaction(async client => {
      const s = await client.query(`SELECT a.id FROM audio_sessions a JOIN audio_participants p ON p.session_id=a.id
        WHERE a.id=$1 AND p.user_id=$2 AND p.left_at IS NULL AND a.state IN ('created','playing','paused') FOR UPDATE OF a`, [sessionId,userId]);
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
    const r = await this.db.query(`UPDATE audio_queue_items q SET state='removed' FROM audio_sessions a
      WHERE q.id=$1 AND q.session_id=$2 AND a.id=q.session_id AND a.host_user_id=$3
      AND q.state IN ('queued','current') RETURNING q.id`, [itemId,sessionId,userId]);
    if (!r.rowCount) throw new NotFoundException('Queue item not found.');
    await this.db.query(`UPDATE audio_sessions SET server_version=server_version+1,updated_at=now() WHERE id=$1`, [sessionId]);
    return { removed: true };
  }

  async updatePlayback(userId: string, sessionId: string, input: { action?: unknown; positionMs?: unknown; currentItemId?: unknown; expectedVersion?: unknown }) {
    this.id(sessionId, 'session id');
    const action = String(input?.action ?? '');
    if (!['play','pause','seek','next','end'].includes(action)) throw new BadRequestException('Invalid playback action.');
    const position = input?.positionMs === undefined ? 0 : Number(input.positionMs);
    if (!Number.isSafeInteger(position) || position < 0 || position > 86400000) throw new BadRequestException('Invalid playback position.');
    if (input?.expectedVersion !== undefined && (!Number.isSafeInteger(Number(input.expectedVersion)) || Number(input.expectedVersion) < 1)) throw new BadRequestException('Invalid expected version.');
    const itemId = input?.currentItemId ?? null;
    if (itemId !== null) this.id(String(itemId), 'queue item id');
    return this.db.transaction(async client => {
      const s = await client.query(`SELECT id,host_user_id,server_version FROM audio_sessions WHERE id=$1 FOR UPDATE`, [sessionId]);
      if (!s.rowCount) throw new NotFoundException('Audio session not found.');
      if (s.rows[0].host_user_id !== userId) throw new ForbiddenException('Only the host can control playback.');
      if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(s.rows[0].server_version)) throw new ConflictException('Playback state changed; refresh and retry.');
      if (itemId !== null) {
        const item = await client.query(`SELECT id FROM audio_queue_items WHERE id=$1 AND session_id=$2 AND state IN ('queued','current')`, [itemId,sessionId]);
        if (!item.rowCount) throw new NotFoundException('Queue item not found.');
      }
      const state = action === 'end' ? 'ended' : action === 'play' ? 'playing' : action === 'pause' ? 'paused' : undefined;
      const playback = action === 'end' ? 'ended' : action === 'play' ? 'playing' : action === 'pause' ? 'paused' : undefined;
      const r = await client.query(`UPDATE audio_sessions SET
        state=COALESCE($2,state),playback_state=COALESCE($3,playback_state),
        position_ms=CASE WHEN $4 THEN $5 ELSE position_ms END,
        current_item_id=COALESCE($6,current_item_id),server_version=server_version+1,updated_at=now()
        WHERE id=$1 RETURNING id,state,playback_state,position_ms,current_item_id,server_version,updated_at`,
        [sessionId,state ?? null,playback ?? null,action==='seek',position,itemId]);
      if (itemId !== null) await client.query(`UPDATE audio_queue_items SET state=CASE WHEN id=$1 THEN 'current' WHEN state='current' THEN 'played' ELSE state END WHERE session_id=$2 AND state IN ('queued','current')`, [itemId,sessionId]);
      if (action === 'end') await client.query(`UPDATE audio_queue_items SET state='played' WHERE session_id=$1 AND state IN ('queued','current')`, [sessionId]);
      return r.rows[0];
    });
  }

  async vote(userId: string, sessionId: string, itemId: string, vote: unknown) {
    this.id(sessionId, 'session id'); this.id(itemId, 'queue item id');
    const value = Number(vote);
    if (value !== -1 && value !== 1) throw new BadRequestException('Vote must be -1 or 1.');
    return this.db.transaction(async client => {
      const allowed = await client.query(`SELECT 1 FROM audio_queue_items q JOIN audio_participants p ON p.session_id=q.session_id
        WHERE q.id=$1 AND q.session_id=$2 AND p.user_id=$3 AND p.left_at IS NULL AND q.state='queued'`, [itemId,sessionId,userId]);
      if (!allowed.rowCount) throw new NotFoundException('Queue item or active participant not found.');
      const r = await client.query(`INSERT INTO audio_votes(queue_item_id,user_id,vote) VALUES($1,$2,$3)
        ON CONFLICT(queue_item_id,user_id) DO UPDATE SET vote=EXCLUDED.vote RETURNING queue_item_id,vote`, [itemId,userId,value]);
      return r.rows[0];
    });
  }
}
