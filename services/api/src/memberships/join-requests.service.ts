import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class JoinRequestsService {
  constructor(private readonly db:DatabaseService) {}

  async create(userId:string,spaceId:string) {
    return this.db.transaction(async client=>{
      const space=await client.query(
        `SELECT s.id,s.type,s.visibility,c.join_policy
         FROM spaces s JOIN circle_details c ON c.space_id=s.id
         WHERE s.id=$1 AND s.type='CIRCLE' AND s.status='active'
           AND s.visibility IN ('public','unlisted') AND c.join_policy='approval'
         FOR UPDATE OF s`,[spaceId]);
      if(!space.rowCount) throw new NotFoundException('Circle not found or does not accept join requests.');
      const member=await client.query(
        `SELECT state FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE`,
        [spaceId,userId]);
      if(member.rowCount&&member.rows[0].state==='active') throw new BadRequestException('You are already a member of this circle.');
      if(member.rowCount&&member.rows[0].state==='banned') throw new ForbiddenException('Banned members cannot request access.');
      const pending=await client.query(
        `SELECT id FROM space_join_requests WHERE space_id=$1 AND requester_id=$2 AND status='pending'`,
        [spaceId,userId]);
      if(pending.rowCount) throw new BadRequestException('A join request is already pending.');
      const created=await client.query(
        `INSERT INTO space_join_requests(space_id,requester_id,status)
         VALUES($1,$2,'pending') RETURNING id,space_id,requester_id,status,created_at`,
        [spaceId,userId]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
         VALUES($1,$2,'membership.join_requested','join_request',$3)`,
        [spaceId,userId,created.rows[0].id]);
      return created.rows[0];
    });
  }

  async list(actorId:string,spaceId:string) {
    const access=await this.db.query(
      `SELECT 1 FROM space_memberships
       WHERE space_id=$1 AND user_id=$2 AND state='active' AND role IN ('owner','admin')`,
      [spaceId,actorId]);
    if(!access.rowCount) throw new NotFoundException('Circle not found or permission denied.');
    const result=await this.db.query(
      `SELECT r.id,r.requester_id,up.display_name,up.avatar_media_id,r.status,r.created_at
       FROM space_join_requests r JOIN user_profiles up ON up.user_id=r.requester_id
       WHERE r.space_id=$1 AND r.status='pending'
       ORDER BY r.created_at ASC LIMIT 100`,[spaceId]);
    return result.rows;
  }

  async review(actorId:string,spaceId:string,requestId:string,decision:'approved'|'rejected') {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const request=await client.query(
        `SELECT r.id,r.requester_id,r.status,s.id AS space_id
         FROM space_join_requests r JOIN spaces s ON s.id=r.space_id
         JOIN space_memberships actor ON actor.space_id=s.id AND actor.user_id=$1
           AND actor.state='active' AND actor.role IN ('owner','admin')
         WHERE r.id=$2 AND r.space_id=$3 AND s.type='CIRCLE' AND s.status='active'
         FOR UPDATE OF r,s`,[actorId,requestId,spaceId]);
      if(!request.rowCount) throw new NotFoundException('Join request not found or permission denied.');
      const row=request.rows[0] as Record<string,unknown>;
      if(row.status!=='pending') throw new BadRequestException('Join request is no longer pending.');
      if(decision==='approved') {
        const member=await client.query(
          `SELECT state FROM space_memberships WHERE space_id=$1 AND user_id=$2 FOR UPDATE`,
          [spaceId,row.requester_id]);
        if(member.rowCount&&member.rows[0].state==='banned') throw new ForbiddenException('Banned members cannot be approved.');
        if(member.rowCount) {
          await client.query(
            `UPDATE space_memberships SET role='member',state='active',joined_at=now(),left_at=NULL
             WHERE space_id=$1 AND user_id=$2`,[spaceId,row.requester_id]);
        } else {
          await client.query(
            `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
             VALUES($1,$2,'member','active',now())`,[spaceId,row.requester_id]);
        }
      }
      await client.query(
        `UPDATE space_join_requests SET status=$2,reviewed_by=$3,reviewed_at=now()
         WHERE id=$1`,[requestId,decision,actorId]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
         VALUES($1,$2,$3,'join_request',$4)`,
        [spaceId,actorId,decision==='approved'?'membership.join_approved':'membership.join_rejected',requestId]);
      return {requestId,spaceId,requesterId:row.requester_id,status:decision};
    });
  }

  async cancel(userId:string,spaceId:string,requestId:string) {
    const result=await this.db.transaction(async client=>{
      const updated=await client.query(
        `UPDATE space_join_requests SET status='cancelled',reviewed_at=now(),reviewed_by=$1
         WHERE id=$2 AND space_id=$3 AND requester_id=$1 AND status='pending'
         RETURNING id`,[userId,requestId,spaceId]);
      if(!updated.rowCount) throw new NotFoundException('Pending join request not found.');
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
         VALUES($1,$2,'membership.join_cancelled','join_request',$3)`,
        [spaceId,userId,requestId]);
      return {requestId,spaceId,status:'cancelled'};
    });
    return result;
  }
}
