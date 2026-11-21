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


  async claimDueDeletionRequests(workerId: string, limit = 10) {
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    const batch = Math.min(Math.max(Number(limit) || 10, 1), 25);
    return this.db.transaction(async client => {
      const claimed = await client.query(
        `WITH candidates AS (
           SELECT id FROM account_deletion_requests
           WHERE status='pending' AND scheduled_for<=now()
             AND processing_attempts<8
             AND (processing_started_at IS NULL OR processing_started_at<now()-interval '15 minutes')
           ORDER BY scheduled_for,requested_at
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE account_deletion_requests r
         SET processing_started_at=now(),processing_worker_id=$2,
             processing_attempts=r.processing_attempts+1,last_error_code=NULL
         FROM candidates c WHERE r.id=c.id
         RETURNING r.id,r.user_id,r.requested_at,r.scheduled_for,r.processing_attempts`,
        [batch,workerId],
      );
      return claimed.rows;
    });
  }

  async completeDeletionRequest(workerId: string, requestId: string, input: unknown) {
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      throw new BadRequestException('Invalid deletion request id.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Worker result is required.');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['success','errorCode','purged'].includes(key)) ||
        typeof value.success !== 'boolean' ||
        (value.success && value.purged !== true) ||
        (value.errorCode !== undefined && (typeof value.errorCode !== 'string' || value.errorCode.length > 120))) {
      throw new BadRequestException('A successful deletion must confirm purged=true.');
    }
    return this.db.transaction(async client => {
      const locked = await client.query(
        `SELECT id,user_id,processing_attempts FROM account_deletion_requests
         WHERE id=$1 AND status='pending' AND processing_worker_id=$2
           AND processing_started_at IS NOT NULL AND scheduled_for<=now()
         FOR UPDATE`, [requestId,workerId]);
      if (!locked.rowCount) throw new NotFoundException('Deletion request not found or not owned by this worker.');
      const request = locked.rows[0];
      if (!value.success) {
        const updated = await client.query(
          `UPDATE account_deletion_requests
           SET processing_started_at=NULL,processing_worker_id=NULL,
               last_error_code=$3
           WHERE id=$1 AND processing_worker_id=$2
           RETURNING id,status,processing_attempts,last_error_code`,
          [requestId,workerId,String(value.errorCode ?? 'ACCOUNT_PURGE_FAILED').slice(0,120)]);
        return { ...updated.rows[0], retryable: Number(request.processing_attempts) < 8 };
      }
      await client.query(
        `UPDATE users SET status='deleted',deleted_at=now(),deletion_requested_at=NULL,
           email_normalized=NULL,phone_e164=NULL,updated_at=now()
         WHERE id=$1 AND status='deletion_pending'`, [request.user_id]);
      const completed = await client.query(
        `UPDATE account_deletion_requests
         SET status='completed',completed_at=now(),processing_started_at=NULL,
             processing_worker_id=NULL,last_error_code=NULL
         WHERE id=$1 AND processing_worker_id=$2
         RETURNING id,status,completed_at`, [requestId,workerId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_completed','account',$1,jsonb_build_object('requestId',$2))`,
        [request.user_id,requestId]);
      return completed.rows[0];
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
