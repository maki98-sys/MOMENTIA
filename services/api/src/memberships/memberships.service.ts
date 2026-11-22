import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MembershipsService {
  constructor(private readonly database: DatabaseService) {}

  async list(userId: string, spaceId: string) {
    const result = await this.database.query(
      `SELECT sm.user_id, sm.role, sm.state, sm.joined_at,
              p.display_name, p.avatar_media_id
       FROM space_memberships sm
       JOIN users u ON u.id = sm.user_id
       LEFT JOIN user_profiles p ON p.user_id = sm.user_id
       WHERE sm.space_id = $1
         AND EXISTS (
           SELECT 1 FROM space_memberships caller
           WHERE caller.space_id = $1 AND caller.user_id = $2 AND caller.state = 'active'
         )
       ORDER BY sm.joined_at ASC, sm.user_id ASC`,
      [spaceId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Space not found.');
    return result.rows;
  }

  async changeRole(actorId: string, spaceId: string, targetId: string, role: unknown) {
    if (!['admin', 'moderator', 'member', 'guest'].includes(String(role))) {
      throw new BadRequestException('Unsupported membership role.');
    }
    return this.database.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const current=await client.query(
        `SELECT target.role FROM space_memberships target
         WHERE target.space_id=$2 AND target.user_id=$3 AND target.state='active'
           AND target.role<>'owner'
           AND EXISTS (SELECT 1 FROM space_memberships actor
             WHERE actor.space_id=target.space_id AND actor.user_id=$1
               AND actor.state='active' AND actor.role IN ('owner','admin'))
           AND (target.role<>'admin' OR EXISTS (SELECT 1 FROM space_memberships owner
             WHERE owner.space_id=target.space_id AND owner.user_id=$1
               AND owner.state='active' AND owner.role='owner'))
           AND ($4<>'admin' OR EXISTS (SELECT 1 FROM space_memberships owner
             WHERE owner.space_id=target.space_id AND owner.user_id=$1
               AND owner.state='active' AND owner.role='owner'))
         FOR UPDATE OF target`,
        [actorId,spaceId,targetId,role],
      );
      if(!current.rowCount) throw new NotFoundException('Member not found or permission denied.');
      const previousRole=String(current.rows[0].role);
      const result=await client.query(
        `UPDATE space_memberships SET role=$3
         WHERE space_id=$1 AND user_id=$2 AND state='active'
         RETURNING user_id,role,state`,
        [spaceId,targetId,role],
      );
      if(!result.rowCount) throw new NotFoundException('Member not found or permission denied.');
      if(previousRole!==String(role)) await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,'membership.role_changed','membership',$3,
           jsonb_build_object('targetUserId',$4,'previousRole',$5,'newRole',$6))`,
        [spaceId,actorId,targetId,targetId,previousRole,String(role)],
      );
      if(!['owner','admin','moderator'].includes(String(role))) {
        const ended=await client.query(
          `UPDATE audio_sessions SET state='ended',playback_state='ended',position_ms=0,
             current_item_id=NULL,server_version=server_version+1,updated_at=now()
           WHERE space_id=$1 AND host_user_id=$2 AND state IN ('created','playing','paused')
           RETURNING id`,
          [spaceId,targetId],
        );
        if(ended.rowCount) {
          await client.query(
            `UPDATE audio_queue_items SET state='played'
             WHERE session_id=ANY($1::uuid[]) AND state IN ('queued','current')`,
            [ended.rows.map((row:{id:string})=>row.id)],
          );
          await client.query(
            `UPDATE audio_participants SET left_at=COALESCE(left_at,now())
             WHERE session_id=ANY($1::uuid[]) AND left_at IS NULL`,
            [ended.rows.map((row:{id:string})=>row.id)],
          );
        }
      }
      return result.rows[0];
    });
  }

  async remove(actorId: string, spaceId: string, targetId: string) {
    if (actorId === targetId) throw new BadRequestException('Use the leave endpoint to remove yourself.');
    return this.database.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const result = await client.query(
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
      await this.endDepartedAudioParticipation(client,spaceId,targetId);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,'membership.removed','membership',$3,jsonb_build_object('targetUserId',$3))`,
        [spaceId,actorId,targetId],
      );
      return result.rows[0];
    });
  }

  async transferOwnership(actorId: string, spaceId: string, targetId: string) {
    if (actorId === targetId) {
      throw new BadRequestException('Ownership must be transferred to another active member.');
    }
    return this.database.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
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
    return this.database.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const result = await client.query(
        `UPDATE space_memberships SET state = 'left', left_at = now()
         WHERE space_id = $1 AND user_id = $2 AND state = 'active' AND role <> 'owner'
         RETURNING user_id, state, left_at`,
        [spaceId, userId],
      );
      if (!result.rowCount) throw new BadRequestException('Owner transfer is required before leaving, or membership is inactive.');
      await this.endDepartedAudioParticipation(client,spaceId,userId);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id,metadata)
         VALUES($1,$2,'membership.left','membership',$2,jsonb_build_object('userId',$2))`,
        [spaceId,userId],
      );
      return result.rows[0];
    });
  }

  private async endDepartedAudioParticipation(client: {query:(sql:string,values?:unknown[])=>Promise<any>},spaceId:string,userId:string) {
    const departed=await client.query(
      `UPDATE audio_participants p SET left_at=now()
       FROM audio_sessions a
       WHERE p.session_id=a.id AND a.space_id=$1 AND p.user_id=$2
         AND p.left_at IS NULL AND a.state IN ('created','playing','paused')
       RETURNING p.session_id,p.role`,
      [spaceId,userId],
    );
    if(!departed.rowCount) return;
    const sessionIds=[...new Set(departed.rows.map((row:any)=>String(row.session_id)))];
    const hostSessionIds=[...new Set(departed.rows.filter((row:any)=>row.role==='host').map((row:any)=>String(row.session_id)))];
    if(hostSessionIds.length) {
      const ended=await client.query(
        `UPDATE audio_sessions SET state='ended',playback_state='ended',position_ms=0,
           server_version=server_version+1,updated_at=now()
         WHERE id=ANY($1::uuid[]) AND state IN ('created','playing','paused') RETURNING id`,
        [hostSessionIds],
      );
      if(ended.rowCount) await client.query(
        `UPDATE audio_queue_items SET state='played'
         WHERE session_id=ANY($1::uuid[]) AND state IN ('queued','current')`,
        [ended.rows.map((row:any)=>row.id)],
      );
    }
    const nonHostSessionIds=sessionIds.filter(id=>!hostSessionIds.includes(id));
    if(nonHostSessionIds.length) await client.query(
      `UPDATE audio_sessions SET server_version=server_version+1,updated_at=now()
       WHERE id=ANY($1::uuid[]) AND state IN ('created','playing','paused')`,
      [nonHostSessionIds],
    );
  }
}
