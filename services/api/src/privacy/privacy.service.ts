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
      ['mediaVariants', `SELECT v.media_asset_id,v.variant_type,v.mime_type,v.size_bytes,v.width,v.height,v.created_at
       FROM media_variants v JOIN media_assets a ON a.id=v.media_asset_id
       WHERE a.owner_id=$1 ORDER BY v.created_at`],
      ['ownedSpaces', `SELECT id,type,name,visibility,status,created_at,updated_at FROM spaces WHERE owner_id=$1 ORDER BY created_at`],
      ['spaceInvitationsCreated', `SELECT id,space_id,role,expires_at,max_uses,uses,approval_required,revoked_at,created_at FROM space_invitations WHERE created_by=$1 ORDER BY created_at`],
      ['coupleInvitationsSent', `SELECT id,invitee_user_id,expires_at,accepted_at,revoked_at,created_at FROM couple_space_invitations WHERE inviter_user_id=$1 ORDER BY created_at`],
      ['coupleInvitationsReceived', `SELECT id,inviter_user_id,expires_at,accepted_at,revoked_at,created_at FROM couple_space_invitations WHERE invitee_user_id=$1 ORDER BY created_at`],
      ['eventRsvps', `SELECT r.space_id,r.response,r.guest_count,r.note,r.responded_at FROM event_rsvps r WHERE r.user_id=$1 ORDER BY r.responded_at`],
      ['coupleJournalEntries', `SELECT id,space_id,encode(ciphertext,'base64') ciphertext_base64,encode(nonce,'base64') nonce_base64,encryption_version,key_version,created_at,updated_at,deleted_at FROM couple_journal_entries WHERE author_id=$1 ORDER BY created_at`],
      ['coupleKeyEnvelopes', `SELECT space_id,key_version,algorithm,encode(encrypted_key,'base64') encrypted_key_base64,encode(nonce,'base64') nonce_base64,created_at,updated_at FROM couple_space_key_envelopes WHERE user_id=$1 ORDER BY space_id,key_version`],
      ['deletionRequests', `SELECT id,status,requested_at,scheduled_for,cancelled_at,completed_at,failed_at,last_error_code FROM account_deletion_requests WHERE user_id=$1 ORDER BY requested_at`],
      ['authIdentities', `SELECT provider,provider_subject,created_at FROM auth_identities WHERE user_id=$1 ORDER BY created_at`],
      ['subscriptions', `SELECT s.plan_id,p.code AS plan_code,p.display_name AS plan_name,p.monthly_price_minor,p.currency,p.features,s.status,s.provider,s.provider_customer_id,s.provider_subscription_id,s.current_period_start,s.current_period_end,s.cancel_at_period_end,s.created_at,s.updated_at FROM user_subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.user_id=$1 ORDER BY s.created_at`],
      ['notificationPreferences', `SELECT category,in_app_enabled,push_enabled,updated_at FROM notification_preferences WHERE user_id=$1 ORDER BY category`],
      ['spacesJoined', `SELECT s.id,s.type,s.owner_id,s.name,s.visibility,s.status,s.settings,m.role,m.state,m.joined_at,m.left_at FROM spaces s JOIN space_memberships m ON m.space_id=s.id WHERE m.user_id=$1 ORDER BY s.created_at`],
      ['spaceSubtypeDetails', `SELECT s.id AS space_id,s.type,
        CASE WHEN s.type='EVENT' THEN jsonb_build_object('startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,'moderationMode',e.moderation_mode,'downloadPolicy',e.download_policy)
             WHEN s.type='CIRCLE' THEN jsonb_build_object('description',c.description,'joinPolicy',c.join_policy)
             WHEN s.type='COUPLE' THEN jsonb_build_object('anniversaryDate',p.anniversary_date,'settings',p.settings)
             ELSE '{}'::jsonb END AS details
       FROM spaces s JOIN space_memberships m ON m.space_id=s.id
       LEFT JOIN event_details e ON e.space_id=s.id
       LEFT JOIN circle_details c ON c.space_id=s.id
       LEFT JOIN couple_details p ON p.space_id=s.id
       WHERE m.user_id=$1 ORDER BY s.created_at`],
      ['albumsCreated', `SELECT id,space_id,name,description,visibility,event_starts_at,event_ends_at,created_at,updated_at FROM space_albums WHERE created_by=$1 ORDER BY created_at`],
      ['albumItemsAdded', `SELECT i.id,i.album_id,i.media_asset_id,i.caption,i.occurred_at,i.status,i.created_at FROM space_album_items i WHERE i.added_by=$1 ORDER BY i.created_at`],
      ['timelineEntries', `SELECT t.id,t.space_id,t.post_id,t.media_asset_id,t.occurred_at,t.source,t.created_at FROM timeline_entries t JOIN space_memberships m ON m.space_id=t.space_id WHERE m.user_id=$1 ORDER BY t.occurred_at`],
      ['audioSessionsHosted', `SELECT id,space_id,state,source_provider,provider_context_id,current_item_id,position_ms,playback_state,scheduled_at,server_version,created_at,updated_at FROM audio_sessions WHERE host_user_id=$1 ORDER BY created_at`],
      ['audioParticipations', `SELECT p.id,p.session_id,p.device_id,p.role,p.joined_at,p.last_heartbeat_at,p.left_at FROM audio_participants p WHERE p.user_id=$1 ORDER BY p.joined_at`],
      ['audioQueueItemsAdded', `SELECT q.id,q.session_id,q.provider_track_reference,q.position,q.state,q.created_at FROM audio_queue_items q WHERE q.added_by=$1 ORDER BY q.created_at`],
      ['audioVotes', `SELECT v.queue_item_id,v.vote,v.created_at FROM audio_votes v WHERE v.user_id=$1 ORDER BY v.created_at`],
      ['joinRequests', `SELECT id,space_id,status,created_at,reviewed_at FROM space_join_requests WHERE requester_id=$1 ORDER BY created_at`],
      ['moderationActions', `SELECT report_id,target_type,target_id,decision,action,note,created_at FROM moderation_audit_events WHERE moderator_id=$1 ORDER BY created_at`],
      ['storageUsageEvents', `SELECT event_type,bytes_delta,idempotency_key,metadata,created_at FROM storage_usage_events WHERE user_id=$1 ORDER BY created_at`],
    ];
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const entries: Array<[string,Record<string,unknown>[]]> = [];
      for (const [key,sql] of queries) {
        const result = await client.query(sql,[userId]);
        entries.push([key,result.rows]);
      }
      return {
        format: 'momentia-data-export-v1',
        exportedAt: new Date().toISOString(),
        consistency: 'repeatable_read',
        data: Object.fromEntries(entries),
      };
    });
  }

  async requestDeletion(userId: string) {
    return this.db.transaction(async client => {
      // Acquire the authorization write lock before taking row locks in this transaction.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");

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
        `UPDATE notification_outbox
         SET status='cancelled',processing_started_at=NULL,last_error_code='ACCOUNT_DELETION_PENDING'
         WHERE user_id=$1 AND channel='push'
           AND status IN ('pending','failed','processing')`,[userId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_requested','account',$1,
           jsonb_build_object('requestId',$2::text,'scheduledFor',$3::timestamptz))`,
        [userId,inserted.rows[0].id,inserted.rows[0].scheduled_for]);
      return { ...inserted.rows[0], gracePeriodDays: 30, sessionsRevoked: true };
    });
  }


  async claimDueDeletionRequests(workerId: string, limit = 10) {
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('Deletion batch limit must be an integer between 1 and 50.');
    }
    const batch = Math.min(limit, 25);
    return this.db.transaction(async client => {
      // Acquire the authorization write lock before taking row locks in this transaction.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");

      // A worker may disappear while holding its final lease. Such requests
      // must become terminal failures instead of remaining pending forever.
      await client.query(
        `UPDATE account_deletion_requests
         SET status='failed',failed_at=now(),processing_started_at=NULL,
             processing_worker_id=NULL,last_error_code='MAX_ATTEMPTS_LEASE_EXPIRED'
         WHERE status='pending' AND processing_attempts>=8
           AND processing_started_at IS NOT NULL
           AND processing_started_at<now()-interval '15 minutes'`,
      );
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
      for (const request of claimed.rows) {
        const assets = await client.query(
          `SELECT id,size_bytes,storage_key_original,storage_provider
           FROM media_assets WHERE owner_id=$1 AND status<>'deleted'
           FOR UPDATE`,
          [request.user_id],
        );
        for (const asset of assets.rows) {
          const variants = await client.query(
            `SELECT storage_key,size_bytes,storage_provider FROM media_variants WHERE media_asset_id=$1 FOR UPDATE`,
            [asset.id],
          );
          const objects = [
            {storage_key:asset.storage_key_original,storage_provider:asset.storage_provider},
            ...variants.rows.map((row: {storage_key:string;storage_provider:string})=>row),
          ];
          for (const object of objects) {
            await client.query(
              `INSERT INTO media_storage_deletions(media_asset_id,storage_key,storage_provider)
               VALUES($1,$2,$3) ON CONFLICT(media_asset_id,storage_key) DO NOTHING`,
              [asset.id,object.storage_key,object.storage_provider],
            );
          }
          await client.query(
            `UPDATE media_processing_jobs SET status='cancelled',locked_at=NULL,locked_by=NULL,updated_at=now()
             WHERE media_asset_id=$1 AND status IN ('pending','processing','failed')`,
            [asset.id],
          );
          await client.query(
            `UPDATE posts SET status='removed',updated_at=now()
             WHERE media_asset_id=$1 AND status<>'removed'`,
            [asset.id],
          );
          await client.query(
            `UPDATE space_album_items SET status='removed',removed_at=now()
             WHERE media_asset_id=$1 AND status='active'`,
            [asset.id],
          );
          await client.query(
            `DELETE FROM timeline_entries
             WHERE media_asset_id=$1 OR post_id IN (SELECT id FROM posts WHERE media_asset_id=$1)`,
            [asset.id],
          );
          await client.query(
            `UPDATE media_assets SET status='deleted',deleted_at=now() WHERE id=$1`,
            [asset.id],
          );
          await client.query(
            `INSERT INTO storage_usage_events(user_id,media_asset_id,event_type,bytes_delta,idempotency_key)
             VALUES($1,$2,'deleted',$3,$4) ON CONFLICT(idempotency_key) DO NOTHING`,
            [request.user_id,asset.id,-(Number(asset.size_bytes)+variants.rows.reduce((sum: number,row: {size_bytes: string|number})=>sum+Number(row.size_bytes),0)),'account-delete-media:'+asset.id],
          );
        }
        await client.query(
          `UPDATE user_profiles SET avatar_media_id=NULL,updated_at=now() WHERE user_id=$1`,
          [request.user_id],
        );
      }
      return claimed.rows.map((request: Record<string,unknown>)=>({
        ...request,
        purgePreparation:'media_deletion_queued',
      }));
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
      // Acquire the authorization write lock before taking row locks in this transaction.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");

      const locked = await client.query(
        `SELECT id,user_id,processing_attempts FROM account_deletion_requests
         WHERE id=$1 AND status='pending' AND processing_worker_id=$2
           AND processing_started_at IS NOT NULL AND scheduled_for<=now()
         FOR UPDATE`, [requestId,workerId]);
      if (!locked.rowCount) throw new NotFoundException('Deletion request not found or not owned by this worker.');
      const request = locked.rows[0];
      if (value.success) {
        const outstandingMedia = await client.query(
          `SELECT count(*)::int total FROM media_assets
           WHERE owner_id=$1 AND status<>'deleted'`,
          [request.user_id],
        );
        const outstandingStorage = await client.query(
          `SELECT count(*)::int total
           FROM media_storage_deletions d
           JOIN media_assets a ON a.id=d.media_asset_id
           WHERE a.owner_id=$1 AND d.status<>'completed'`,
          [request.user_id],
        );
        const activeJobs = await client.query(
          `SELECT count(*)::int total FROM media_processing_jobs j
           JOIN media_assets a ON a.id=j.media_asset_id
           WHERE a.owner_id=$1 AND j.status IN ('pending','processing')`,
          [request.user_id],
        );
        if (Number(outstandingMedia.rows[0].total)>0 ||
            Number(outstandingStorage.rows[0].total)>0 ||
            Number(activeJobs.rows[0].total)>0) {
          throw new ConflictException('Account purge cannot finish while media or storage deletion tasks remain.');
        }
      }
      if (!value.success) {
        const updated = await client.query(
          `UPDATE account_deletion_requests
           SET status=CASE WHEN processing_attempts>=8 THEN 'failed' ELSE 'pending' END,
               failed_at=CASE WHEN processing_attempts>=8 THEN now() ELSE NULL END,
               processing_started_at=NULL,processing_worker_id=NULL,
               last_error_code=$3,
               scheduled_for=CASE WHEN processing_attempts<8
                 THEN now()+make_interval(secs=>LEAST(3600,30*(2^LEAST(processing_attempts,7))::integer))
                 ELSE scheduled_for END
           WHERE id=$1 AND processing_worker_id=$2
           RETURNING id,status,processing_attempts,last_error_code,failed_at`,
          [requestId,workerId,String(value.errorCode ?? 'ACCOUNT_PURGE_FAILED').slice(0,120)]);
        return { ...updated.rows[0], retryable: Number(request.processing_attempts) < 8 };
      }
      // Revoke invitations and remove account-scoped delivery/preferences before anonymizing.
      await client.query(
        `UPDATE space_invitations SET revoked_at=COALESCE(revoked_at,now())
         WHERE created_by=$1 AND revoked_at IS NULL`, [request.user_id]);
      await client.query(
        `UPDATE couple_space_invitations SET revoked_at=COALESCE(revoked_at,now())
         WHERE (inviter_user_id=$1 OR invitee_user_id=$1)
           AND accepted_at IS NULL AND revoked_at IS NULL`, [request.user_id]);
      await client.query(`DELETE FROM event_rsvps WHERE user_id=$1`, [request.user_id]);
      await client.query(`DELETE FROM couple_space_key_envelopes WHERE user_id=$1`, [request.user_id]);
      await client.query(`DELETE FROM notification_preferences WHERE user_id=$1`, [request.user_id]);
      await client.query(`DELETE FROM notifications WHERE user_id=$1`, [request.user_id]);
      await client.query(`DELETE FROM idempotency_records WHERE actor_id=$1`, [request.user_id]);

      // A deleted account must not remain an active Social Audio host or listener.
      // End hosted sessions before membership and identity anonymization.
      const hostedSessions = await client.query(
        `UPDATE audio_sessions
         SET state='ended',playback_state='ended',position_ms=0,
             current_item_id=NULL,server_version=server_version+1,updated_at=now()
         WHERE host_user_id=$1 AND state IN ('created','playing','paused')
         RETURNING id`,
        [request.user_id],
      );
      if (hostedSessions.rowCount) {
        await client.query(
          `UPDATE audio_queue_items SET state='played'
           WHERE session_id=ANY($1::uuid[]) AND state IN ('queued','current')`,
          [hostedSessions.rows.map((row: {id:string})=>row.id)],
        );
      }
      await client.query(
        `UPDATE audio_participants SET left_at=COALESCE(left_at,now())
         WHERE user_id=$1 AND left_at IS NULL`,
        [request.user_id],
      );

      // Transfer owned spaces to an active member where possible. Couple spaces retain
      // both active memberships to preserve the two-party invariant and encrypted history.
      const ownedSpaces = await client.query(
        `SELECT id,type,status FROM spaces WHERE owner_id=$1 ORDER BY created_at FOR UPDATE`,
        [request.user_id],
      );
      for (const space of ownedSpaces.rows) {
        const successor = await client.query(
          `SELECT sm.user_id
           FROM space_memberships sm
           JOIN users u ON u.id=sm.user_id AND u.status='active'
           WHERE sm.space_id=$1 AND sm.user_id<>$2 AND sm.state='active'
           ORDER BY CASE sm.role WHEN 'admin' THEN 0 WHEN 'moderator' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                    sm.joined_at NULLS LAST,sm.created_at,sm.user_id
           LIMIT 1 FOR UPDATE OF sm`,
          [space.id,request.user_id],
        );
        if (successor.rowCount) {
          await client.query(
            `UPDATE spaces SET owner_id=$2,updated_at=now() WHERE id=$1`,
            [space.id,successor.rows[0].user_id],
          );
          await client.query(
            `UPDATE space_memberships SET role='owner' WHERE space_id=$1 AND user_id=$2 AND state='active'`,
            [space.id,successor.rows[0].user_id],
          );
          if (space.type !== 'COUPLE') {
            await client.query(
              `UPDATE space_memberships SET state='left',left_at=now(),joined_at=COALESCE(joined_at,created_at),role='member'
               WHERE space_id=$1 AND user_id=$2 AND state='active'`,
              [space.id,request.user_id],
            );
          } else {
            await client.query(
              `UPDATE space_memberships SET role='member'
               WHERE space_id=$1 AND user_id=$2 AND state='active'`,
              [space.id,request.user_id],
            );
          }
        } else {
          await client.query(
            `UPDATE spaces SET status='archived',updated_at=now() WHERE id=$1 AND status='active'`,
            [space.id],
          );
          await client.query(
            `UPDATE space_memberships SET state='left',left_at=now(),joined_at=COALESCE(joined_at,created_at),role='member'
             WHERE space_id=$1 AND user_id=$2 AND state='active'`,
            [space.id,request.user_id],
          );
        }
      }
      // Leave non-owned spaces. A couple space is intentionally retained for its
      // remaining partner; its deleted member remains as a non-authenticating tombstone.
      await client.query(
        `UPDATE space_memberships sm SET state='left',left_at=now()
         WHERE sm.user_id=$1 AND sm.state='active'
           AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=sm.space_id AND s.type='COUPLE')
           AND NOT EXISTS (SELECT 1 FROM spaces s WHERE s.id=sm.space_id AND s.owner_id=$1)`,
        [request.user_id],
      );
      // Remove authored social content while retaining shared spaces and moderation audit records.
      await client.query(
        `UPDATE posts SET status='removed',body='[contenido eliminado]',updated_at=now()
         WHERE author_id=$1 AND status<>'removed'`,[request.user_id]);
      await client.query(
        `UPDATE post_comments SET status='removed',body='[contenido eliminado]'
         WHERE author_id=$1 AND status<>'removed'`,[request.user_id]);
      await client.query(
        `DELETE FROM content_reactions WHERE user_id=$1`,[request.user_id]);
      await client.query(
        `DELETE FROM timeline_entries
         WHERE post_id IN (SELECT id FROM posts WHERE author_id=$1)`,
        [request.user_id]);
      await client.query(
        `DELETE FROM couple_journal_entries WHERE author_id=$1`,[request.user_id]);
      // Stop all Social Audio activity before the account becomes a non-authenticating tombstone.
      // This also covers retained COUPLE spaces and sessions in spaces transferred to another owner.
      const hostedAudio = await client.query(
        `SELECT id FROM audio_sessions
         WHERE host_user_id=$1 AND state IN ('created','playing','paused')
         FOR UPDATE`,
        [request.user_id],
      );
      if (hostedAudio.rowCount) {
        const sessionIds = hostedAudio.rows.map((row: {id:string}) => row.id);
        await client.query(
          `UPDATE audio_participants SET left_at=COALESCE(left_at,now())
           WHERE session_id=ANY($1::uuid[]) AND left_at IS NULL`,
          [sessionIds],
        );
        await client.query(
          `UPDATE audio_queue_items SET state='played'
           WHERE session_id=ANY($1::uuid[]) AND state IN ('queued','current')`,
          [sessionIds],
        );
        await client.query(
          `UPDATE audio_sessions SET state='ended',playback_state='ended',position_ms=0,
             current_item_id=NULL,server_version=server_version+1,updated_at=now()
           WHERE id=ANY($1::uuid[])`,
          [sessionIds],
        );
      }
      await client.query(
        `UPDATE audio_participants SET left_at=COALESCE(left_at,now())
         WHERE user_id=$1 AND left_at IS NULL`,
        [request.user_id],
      );
      await client.query(
        `DELETE FROM audio_votes WHERE user_id=$1`,
        [request.user_id],
      );
      await client.query(
        `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now())
         WHERE user_id=$1 AND revoked_at IS NULL`, [request.user_id]);
      await client.query(
        `UPDATE users SET status='deleted',deleted_at=now(),deletion_requested_at=NULL,
           email_normalized='deleted+'||id::text||'@deleted.invalid',phone_e164=NULL,updated_at=now()
         WHERE id=$1 AND status='deletion_pending'`, [request.user_id]);
      await client.query(`DELETE FROM auth_identities WHERE user_id=$1`, [request.user_id]);
      await client.query(
        `UPDATE user_profiles SET display_name='Cuenta eliminada',bio=NULL,avatar_media_id=NULL,
           preferences='{}'::jsonb,updated_at=now() WHERE user_id=$1`, [request.user_id]);
      // Purge private delivery and offline-sync state; the account remains only as a
      // non-authenticating tombstone for retained ownership/audit foreign keys.
      await client.query(`DELETE FROM notification_outbox WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM notifications WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM notification_preferences WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM sync_snapshot_sessions WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM sync_operation_receipts WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM sync_change_log WHERE user_id=$1`,[request.user_id]);
      await client.query(`DELETE FROM couple_space_key_envelopes WHERE user_id=$1`,[request.user_id]);
      await client.query(
        `DELETE FROM user_relationships WHERE requester_id=$1 OR target_id=$1`, [request.user_id]);
      await client.query(
        `DELETE FROM user_blocks WHERE blocker_id=$1 OR blocked_id=$1`, [request.user_id]);
      await client.query(
        `DELETE FROM devices WHERE user_id=$1`, [request.user_id]);
      const completed = await client.query(
        `UPDATE account_deletion_requests
         SET status='completed',completed_at=now(),processing_started_at=NULL,
             processing_worker_id=NULL,last_error_code=NULL
         WHERE id=$1 AND processing_worker_id=$2
         RETURNING id,status,completed_at`, [requestId,workerId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_completed','account',$1,jsonb_build_object('requestId',$2::text))`,
        [request.user_id,requestId]);
      return completed.rows[0];
    });
  }

  async getDeletionStatus(userId: string) {
    const result = await this.db.query(
      `SELECT id,status,requested_at,scheduled_for,cancelled_at,completed_at,failed_at,last_error_code
       FROM account_deletion_requests WHERE user_id=$1
       ORDER BY requested_at DESC LIMIT 1`,[userId]);
    return { request: result.rows[0] ?? null };
  }

  async cancelDeletion(userId: string) {
    return this.db.transaction(async client => {
      // Acquire the authorization write lock before taking row locks in this transaction.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");

      const account = await client.query(
        `SELECT id,status FROM users WHERE id=$1 FOR UPDATE`,[userId]);
      if (!account.rowCount || account.rows[0].status!=='deletion_pending') {
        throw new ConflictException('There is no cancellable deletion request.');
      }
      const request = await client.query(
        `UPDATE account_deletion_requests SET status='cancelled',cancelled_at=now()
         WHERE user_id=$1 AND status IN ('pending','failed')
           AND (status='failed' OR scheduled_for>now())
         RETURNING id`,[userId]);
      if (!request.rowCount) throw new ConflictException('The deletion request can no longer be cancelled.');
      await client.query(
        `UPDATE users SET status='active',deletion_requested_at=NULL WHERE id=$1`,[userId]);
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'account.deletion_cancelled','account',$1,jsonb_build_object('requestId',$2::text))`,
        [userId,request.rows[0].id]);
      return { cancelled: true, requestId: request.rows[0].id };
    });
  }
}
