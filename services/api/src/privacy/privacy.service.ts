import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class PrivacyService {
  constructor(private readonly db: DatabaseService) {}

  async exportMyData(userId: string) {
    const queries: Array<[string,string]> = [
      ['account', `SELECT id,email_normalized,phone_e164,email_verified_at,phone_verified_at,status,created_at,updated_at FROM users WHERE id=$1`],
      ['profile', `SELECT display_name,bio,avatar_media_id,visibility,preferences,created_at,updated_at FROM user_profiles WHERE user_id=$1`],
      ['devices', `SELECT id,platform,last_seen_at,created_at,revoked_at FROM devices WHERE user_id=$1 ORDER BY created_at`],
      ['sessions', `SELECT id,device_id,expires_at,revoked_at,created_at FROM auth_sessions WHERE user_id=$1 ORDER BY created_at`],
      ['relationships_outgoing', `SELECT target_id,state,created_at,updated_at FROM user_relationships WHERE requester_id=$1 ORDER BY created_at`],
      ['relationships_incoming', `SELECT requester_id,state,created_at,updated_at FROM user_relationships WHERE target_id=$1 ORDER BY created_at`],
      ['blocks', `SELECT blocker_id,blocked_id,created_at FROM user_blocks WHERE blocker_id=$1 OR blocked_id=$1`],
      ['posts', `SELECT id,space_id,media_asset_id,body,audience,status,created_at,published_at,updated_at FROM posts WHERE author_id=$1 ORDER BY created_at`],
      ['comments', `SELECT id,post_id,body,status,created_at FROM post_comments WHERE author_id=$1 ORDER BY created_at`],
      ['reactions', `SELECT target_type,target_id,reaction_type,created_at FROM content_reactions WHERE user_id=$1 ORDER BY created_at`],
      ['memberships', `SELECT space_id,role,state,joined_at,left_at,created_at FROM space_memberships WHERE user_id=$1 ORDER BY created_at`],
      ['notifications', `SELECT id,category,payload,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at`],
      ['reports', `SELECT id,target_type,target_id,reason,details,status,created_at,resolved_at FROM user_reports WHERE reporter_id=$1 ORDER BY created_at`],
      ['media', `SELECT id,mime_type_detected,size_bytes,width,height,checksum_sha256,status,created_at,deleted_at FROM media_assets WHERE owner_id=$1 ORDER BY created_at`],
      ['deletionRequests', `SELECT id,status,requested_at,scheduled_for,cancelled_at,completed_at FROM account_deletion_requests WHERE user_id=$1 ORDER BY requested_at`],
    ];
    const entries = await Promise.all(queries.map(async ([key,sql]) => {
      const result = await this.db.query(sql,[userId]);
      return [key,result.rows] as const;
    }));
    return {
      format: 'momentia-data-export-v1',
      exportedAt: new Date().toISOString(),
      data: Object.fromEntries(entries),
    };
  }

  async requestDeletion(userId: string) {
    return this.db.transaction(async client => {
      const account = await client.query(
        `SELECT id,status FROM users WHERE id=$1 FOR UPDATE`,[userId]);
      if (!account.rowCount || account.rows[0].status==='deleted') {
        throw new NotFoundException('Active account not found.');
      }
      if (account.rows[0].status!=='active') {
        throw new ConflictException('Only an active account can request deletion.');
      }
      const inserted = await client.query(
        `INSERT INTO account_deletion_requests(user_id)
         VALUES($1) RETURNING id,status,requested_at,scheduled_for`,[userId]);
      await client.query(
        `UPDATE users SET status='deletion_pending',deletion_requested_at=now() WHERE id=$1`,[userId]);
      await client.query(
        `UPDATE auth_sessions SET revoked_at=now()
         WHERE user_id=$1 AND revoked_at IS NULL`,[userId]);
      await client.query(
        `UPDATE devices SET revoked_at=now()
         WHERE user_id=$1 AND revoked_at IS NULL`,[userId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_requested','account',$1,
           jsonb_build_object('requestId',$2,'scheduledFor',$3))`,
        [userId,inserted.rows[0].id,inserted.rows[0].scheduled_for]);
      return { ...inserted.rows[0], gracePeriodDays: 30, sessionsRevoked: true };
    });
  }

  async getDeletionStatus(userId: string) {
    const result = await this.db.query(
      `SELECT id,status,requested_at,scheduled_for,cancelled_at,completed_at
       FROM account_deletion_requests WHERE user_id=$1
       ORDER BY requested_at DESC LIMIT 1`,[userId]);
    return { request: result.rows[0] ?? null };
  }

  async cancelDeletion(userId: string) {
    return this.db.transaction(async client => {
      const account = await client.query(
        `SELECT id,status FROM users WHERE id=$1 FOR UPDATE`,[userId]);
      if (!account.rowCount || account.rows[0].status!=='deletion_pending') {
        throw new ConflictException('There is no cancellable deletion request.');
      }
      const request = await client.query(
        `UPDATE account_deletion_requests SET status='cancelled',cancelled_at=now()
         WHERE user_id=$1 AND status='pending' AND scheduled_for>now()
         RETURNING id`,[userId]);
      if (!request.rowCount) throw new ConflictException('The deletion request can no longer be cancelled.');
      await client.query(
        `UPDATE users SET status='active',deletion_requested_at=NULL WHERE id=$1`,[userId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_cancelled','account',$1,jsonb_build_object('requestId',$2))`,
        [userId,request.rows[0].id]);
      return { cancelled: true, requestId: request.rows[0].id };
    });
  }
}
