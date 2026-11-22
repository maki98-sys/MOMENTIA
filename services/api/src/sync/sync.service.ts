import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DatabaseService } from '../database/database.service';

type SyncOperation = { operationId: string; type: string; payload: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SyncService {
  constructor(private readonly db: DatabaseService) {}

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => this.canonicalJson(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${this.canonicalJson(record[key])}`).join(',')}}`;
  }

  private requestFingerprint(operation: SyncOperation): string {
    return createHash('sha256')
      .update(this.canonicalJson({ type: operation.type, payload: operation.payload }))
      .digest('hex');
  }

  private parseOperations(input: unknown): SyncOperation[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Sync payload is required.');
    const operations = (input as Record<string, unknown>).operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) {
      throw new BadRequestException('Provide between 1 and 50 operations.');
    }
    return operations.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid sync operation.');
      const value = item as Record<string, unknown>;
      if (Object.keys(value).some(key => !['operationId','type','payload'].includes(key))) throw new BadRequestException('Unsupported sync operation fields.');
      if (!UUID.test(String(value.operationId ?? ''))) throw new BadRequestException('operationId must be a UUID.');
      if (!['post.create', 'timeline.add', 'comment.create', 'comment.update', 'comment.remove', 'reaction.set', 'reaction.remove', 'album.item.add', 'album.item.remove', 'event.rsvp.set', 'event.rsvp.remove', 'couple.journal.create', 'couple.journal.update', 'couple.journal.remove'].includes(String(value.type))) throw new BadRequestException('Unsupported sync operation type.');
      if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new BadRequestException('Operation payload is required.');
      if (Buffer.byteLength(JSON.stringify(value.payload)) > 64000) throw new BadRequestException('Sync operation payload exceeds 64 KB.');
      return { operationId: String(value.operationId), type: String(value.type), payload: value.payload as Record<string, unknown> };
    });
  }

  async push(userId: string, input: unknown) {
    const operations = this.parseOperations(input);
    const results = [];
    for (const operation of operations) {
      const requestHash = this.requestFingerprint(operation);
      try {
        const result = await this.db.transaction(async client => {
          await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
          const receipt = await client.query(
            `INSERT INTO sync_operation_receipts(user_id,operation_id,operation_type,request_hash)
             VALUES($1,$2,$3,$4) ON CONFLICT(user_id,operation_id) DO NOTHING
             RETURNING id`,
            [userId, operation.operationId, operation.type, requestHash],
          );
          if (!receipt.rowCount) {
            const previous = await client.query(
              `SELECT operation_type,state,result,error_code,request_hash,created_at FROM sync_operation_receipts
               WHERE user_id=$1 AND operation_id=$2 FOR UPDATE`,
              [userId, operation.operationId],
            );
            const row = previous.rows[0];
            if (row.operation_type !== operation.type || !row.request_hash || row.request_hash !== requestHash) return { operationId: operation.operationId, state: 'rejected', errorCode: 'IDEMPOTENCY_KEY_REUSED' };
            if (row.state === 'succeeded') return { operationId: operation.operationId, state: 'succeeded', result: row.result, replayed: true };
            if (row.state === 'rejected') return { operationId: operation.operationId, state: 'rejected', errorCode: row.error_code, replayed: true };
            const processingAgeMs = Date.now() - new Date(row.created_at).getTime();
            if (row.state === 'processing' && processingAgeMs > 10 * 60 * 1000) {
              await client.query(
                `UPDATE sync_operation_receipts
                 SET state='rejected',error_code='SYNC_OPERATION_INTERRUPTED',completed_at=now()
                 WHERE user_id=$1 AND operation_id=$2 AND state='processing'`,
                [userId,operation.operationId],
              );
              return { operationId: operation.operationId, state: 'rejected', errorCode: 'SYNC_OPERATION_INTERRUPTED', replayed: true };
            }
            return { operationId: operation.operationId, state: 'processing' };
          }

          let created: any;
          if (operation.type === 'post.create') created = await this.createPost(client, userId, operation.payload);
          else if (operation.type === 'timeline.add') created = await this.addTimelineEntry(client, userId, operation.payload);
          else if (operation.type === 'comment.create') created = await this.createComment(client, userId, operation.payload);
          else if (operation.type === 'comment.update') created = await this.updateComment(client, userId, operation.payload);
          else if (operation.type === 'comment.remove') created = await this.removeComment(client, userId, operation.payload);
          else if (operation.type === 'reaction.set') created = await this.setReaction(client, userId, operation.payload);
          else if (operation.type === 'reaction.remove') created = await this.removeReaction(client, userId, operation.payload);
          else if (operation.type === 'album.item.add') created = await this.addAlbumItem(client, userId, operation.payload);
          else if (operation.type === 'album.item.remove') created = await this.removeAlbumItem(client, userId, operation.payload);
          else if (operation.type === 'event.rsvp.set') created = await this.setEventRsvp(client, userId, operation.payload);
          else if (operation.type === 'event.rsvp.remove') created = await this.removeEventRsvp(client, userId, operation.payload);
          else if (operation.type === 'couple.journal.create') created = await this.createCoupleJournalEntry(client, userId, operation.payload);
          else if (operation.type === 'couple.journal.update') created = await this.updateCoupleJournalEntry(client, userId, operation.payload);
          else created = await this.removeCoupleJournalEntry(client, userId, operation.payload);
          await client.query(
            `UPDATE sync_operation_receipts SET state='succeeded',result=$3::jsonb,completed_at=now()
             WHERE user_id=$1 AND operation_id=$2`,
            [userId, operation.operationId, JSON.stringify(created)],
          );
          return { operationId: operation.operationId, state: 'succeeded', result: created };
        });
        results.push(result);
      } catch (error) {
        const code = this.errorCode(error);
        await this.db.query(
          `INSERT INTO sync_operation_receipts(user_id,operation_id,operation_type,request_hash,state,error_code,completed_at)
           VALUES($1,$2,$3,$4,'rejected',$5,now())
           ON CONFLICT(user_id,operation_id) DO NOTHING`,
          [userId, operation.operationId, operation.type, requestHash, code],
        );
        const persisted = await this.db.query(
          `SELECT operation_type,state,result,error_code,request_hash
           FROM sync_operation_receipts WHERE user_id=$1 AND operation_id=$2`,
          [userId,operation.operationId],
        );
        const row = persisted.rows[0];
        if (!row || row.operation_type !== operation.type || !row.request_hash || row.request_hash !== requestHash) {
          results.push({ operationId: operation.operationId, state: 'rejected', errorCode: 'IDEMPOTENCY_KEY_REUSED' });
        } else if (row.state === 'succeeded') {
          results.push({ operationId: operation.operationId, state: 'succeeded', result: row.result, replayed: true });
        } else if (row.state === 'rejected') {
          results.push({ operationId: operation.operationId, state: 'rejected', errorCode: row.error_code, replayed: true });
        } else {
          results.push({ operationId: operation.operationId, state: 'processing' });
        }
      }
    }
    return { accepted: results.filter(r => r.state === 'succeeded').length, rejected: results.filter(r => r.state === 'rejected').length, results };
  }

  private async resolveInteractablePost(client: any, userId: string, targetType: string, targetId: string) {
    if (!UUID.test(targetId)) throw new Error('INVALID_TARGET_ID');
    const result = targetType === 'post'
      ? await client.query(
        `SELECT p.id,p.author_id,p.space_id,p.audience,p.status,NULL::uuid AS comment_id
         FROM posts p WHERE p.id=$1 AND p.status='published'`, [targetId])
      : await client.query(
        `SELECT p.id,p.author_id,p.space_id,p.audience,p.status,c.id AS comment_id
         FROM post_comments c JOIN posts p ON p.id=c.post_id
         WHERE c.id=$1 AND c.status='visible' AND p.status='published'`, [targetId]);
    if (!result.rowCount) throw new Error('TARGET_NOT_FOUND');
    const post = result.rows[0];
    const access = await client.query(
      `SELECT 1 FROM posts p
       WHERE p.id=$1 AND (
         p.author_id=$2 OR p.audience='public'
         OR (p.audience='followers' AND EXISTS(
           SELECT 1 FROM user_relationships r WHERE r.requester_id=$2
             AND r.target_id=p.author_id AND r.state='accepted'))
         OR (p.audience='space' AND EXISTS(
           SELECT 1 FROM space_memberships sm WHERE sm.space_id=p.space_id
             AND sm.user_id=$2 AND sm.state='active'))
       )
       AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
         (b.blocker_id=$2 AND b.blocked_id=p.author_id) OR
         (b.blocker_id=p.author_id AND b.blocked_id=$2))`,
      [post.id,userId]);
    if (!access.rowCount) throw new Error('TARGET_NOT_ACCESSIBLE');
    if (post.comment_id) {
      const commentAccess = await client.query(
        `SELECT 1 FROM post_comments c
         WHERE c.id=$1
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
             (b.blocker_id=$2 AND b.blocked_id=c.author_id) OR
             (b.blocker_id=c.author_id AND b.blocked_id=$2))`,
        [post.comment_id,userId],
      );
      if (!commentAccess.rowCount) throw new Error('TARGET_NOT_ACCESSIBLE');
    }
    if (post.audience === 'space') {
      const role = await client.query(
        `SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,
        [post.space_id,userId]);
      if (!role.rowCount || role.rows[0].role === 'guest') throw new Error('INTERACTION_NOT_ALLOWED');
    }
    return post;
  }

  private async createComment(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['postId','body'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const postId = payload.postId;
    const body = payload.body;
    if (typeof postId !== 'string' || !UUID.test(postId)) throw new Error('INVALID_POST_ID');
    if (typeof body !== 'string' || !body.trim() || body.length > 3000) throw new Error('INVALID_COMMENT_BODY');
    await this.resolveInteractablePost(client,userId,'post',postId);
    const result = await client.query(
      `INSERT INTO post_comments(post_id,author_id,body,status)
       VALUES($1,$2,$3,'visible')
       RETURNING id,post_id,author_id,body,status,created_at`,
      [postId,userId,body.trim()]);
    return { entityType:'comment', ...result.rows[0] };
  }

  private async updateComment(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['commentId','body'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const commentId = payload.commentId;
    const body = payload.body;
    if (typeof commentId !== 'string' || !UUID.test(commentId)) throw new Error('INVALID_COMMENT_ID');
    if (typeof body !== 'string' || !body.trim() || body.length > 3000) throw new Error('INVALID_COMMENT_BODY');
    await this.resolveInteractablePost(client,userId,'comment',commentId);
    const result = await client.query(
      `UPDATE post_comments SET body=$3
       WHERE id=$1 AND author_id=$2 AND status='visible'
       RETURNING id,post_id,author_id,body,status,created_at`,
      [commentId,userId,body.trim()]);
    if (!result.rowCount) throw new Error('COMMENT_NOT_OWNED_OR_EDITABLE');
    return { entityType:'comment', ...result.rows[0] };
  }

  private async removeComment(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => key !== 'commentId')) throw new Error('INVALID_PAYLOAD');
    const commentId = payload.commentId;
    if (typeof commentId !== 'string' || !UUID.test(commentId)) throw new Error('INVALID_COMMENT_ID');
    await this.resolveInteractablePost(client,userId,'comment',commentId);
    const result = await client.query(
      `UPDATE post_comments SET status='removed'
       WHERE id=$1 AND author_id=$2 AND status='visible'
       RETURNING id,post_id`,
      [commentId,userId]);
    if (!result.rowCount) throw new Error('COMMENT_NOT_OWNED_OR_REMOVABLE');
    await client.query(`DELETE FROM content_reactions WHERE target_type='comment' AND target_id=$1`,[commentId]);
    return { entityType:'comment', id:result.rows[0].id, postId:result.rows[0].post_id, removed:true };
  }

  private async setReaction(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['targetType','targetId','reactionType'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const targetType = String(payload.targetType ?? '');
    const targetId = String(payload.targetId ?? '');
    const reactionType = String(payload.reactionType ?? '');
    if (!['post','comment'].includes(targetType)) throw new Error('INVALID_TARGET_TYPE');
    if (!['like','love','laugh','wow','support'].includes(reactionType)) throw new Error('INVALID_REACTION_TYPE');
    await this.resolveInteractablePost(client,userId,targetType,targetId);
    const result = await client.query(
      `INSERT INTO content_reactions(target_type,target_id,user_id,reaction_type)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(target_type,target_id,user_id) DO UPDATE SET reaction_type=EXCLUDED.reaction_type
       RETURNING id,target_type,target_id,user_id,reaction_type,created_at`,
      [targetType,targetId,userId,reactionType]);
    return { entityType:'reaction', ...result.rows[0] };
  }

  private async removeReaction(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['targetType','targetId'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const targetType = String(payload.targetType ?? '');
    const targetId = String(payload.targetId ?? '');
    if (!['post','comment'].includes(targetType)) throw new Error('INVALID_TARGET_TYPE');
    await this.resolveInteractablePost(client,userId,targetType,targetId);
    await client.query(
      `DELETE FROM content_reactions WHERE target_type=$1 AND target_id=$2 AND user_id=$3`,
      [targetType,targetId,userId]);
    return { entityType:'reaction', targetType, targetId, removed:true };
  }

  private async createPost(client: any, userId: string, payload: Record<string, unknown>) {
    const allowed = ['body','mediaAssetId','audience','spaceId'];
    if (Object.keys(payload).some(key => !allowed.includes(key))) throw new Error('INVALID_PAYLOAD');
    const body = payload.body ?? null;
    const mediaId = payload.mediaAssetId ?? null;
    const audience = String(payload.audience ?? 'followers');
    const spaceId = payload.spaceId ?? null;
    if (body !== null && (typeof body !== 'string' || !body.trim() || body.length > 5000)) throw new Error('INVALID_POST_BODY');
    if (mediaId !== null && (typeof mediaId !== 'string' || !UUID.test(mediaId))) throw new Error('INVALID_MEDIA_ID');
    if (!['public','followers','space','private'].includes(audience)) throw new Error('INVALID_AUDIENCE');
    if ((audience === 'space') !== (typeof spaceId === 'string')) throw new Error('INVALID_SPACE');
    if (spaceId !== null && (typeof spaceId !== 'string' || !UUID.test(spaceId))) throw new Error('INVALID_SPACE');
    if (!body && !mediaId) throw new Error('EMPTY_POST');
    if (mediaId) {
      const media = await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready' FOR SHARE`, [mediaId,userId]);
      if (!media.rowCount) throw new Error('MEDIA_NOT_READY_OR_NOT_OWNED');
    }
    if (spaceId) {
      const member = await client.query(
        `SELECT sm.role FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id
         WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active' AND s.status='active' FOR SHARE OF sm,s`,
        [spaceId,userId],
      );
      if (!member.rowCount) throw new Error('SPACE_ACCESS_DENIED');
      if (member.rows[0].role === 'guest') throw new Error('INTERACTION_NOT_ALLOWED');
    }
    const inserted = await client.query(
      `INSERT INTO posts(author_id,body,media_asset_id,audience,space_id,status,published_at)
       VALUES($1,$2,$3,$4,$5,'published',now())
       RETURNING id,author_id,space_id,media_asset_id,body,audience,status,created_at,published_at`,
      [userId,body,mediaId,audience,spaceId],
    );
    const post = inserted.rows[0];
    if (spaceId) await client.query(
      `INSERT INTO timeline_entries(space_id,post_id,occurred_at,source) VALUES($1,$2,now(),'post')`,
      [spaceId,post.id],
    );
    return { entityType: 'post', ...post };
  }

  private async addTimelineEntry(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['spaceId','postId','mediaAssetId','occurredAt','source'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const { spaceId, postId = null, mediaAssetId = null } = payload;
    if (typeof spaceId !== 'string' || !UUID.test(spaceId) || (Boolean(postId) === Boolean(mediaAssetId))) throw new Error('INVALID_TIMELINE_ENTRY');
    const source = String(payload.source ?? (postId ? 'post' : 'upload'));
    if (!['capture','post','upload','import'].includes(source)) throw new Error('INVALID_TIMELINE_SOURCE');
    const occurredAt = payload.occurredAt ?? new Date().toISOString();
    if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) throw new Error('INVALID_OCCURRED_AT');
    const membership = await client.query(
      `SELECT sm.role FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id
       WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active' AND s.status='active' FOR SHARE OF sm,s`,
      [spaceId,userId],
    );
    if (!membership.rowCount) throw new Error('SPACE_ACCESS_DENIED');
    if (membership.rows[0].role === 'guest') throw new Error('INTERACTION_NOT_ALLOWED');
    if (postId) {
      if (typeof postId !== 'string' || !UUID.test(postId)) throw new Error('INVALID_POST_ID');
      const post = await client.query(
        `SELECT p.id FROM posts p WHERE p.id=$1 AND p.space_id=$2
           AND p.status='published' AND p.audience='space'
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
             (b.blocker_id=$3 AND b.blocked_id=p.author_id)
             OR (b.blocker_id=p.author_id AND b.blocked_id=$3))`,
        [postId,spaceId,userId],
      );
      if (!post.rowCount) throw new Error('POST_NOT_FOUND');
    }
    if (mediaAssetId) {
      if (typeof mediaAssetId !== 'string' || !UUID.test(mediaAssetId)) throw new Error('INVALID_MEDIA_ID');
      const media = await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`, [mediaAssetId,userId]);
      if (!media.rowCount) throw new Error('MEDIA_NOT_READY_OR_NOT_OWNED');
    }
    const inserted = await client.query(
      `INSERT INTO timeline_entries(space_id,post_id,media_asset_id,occurred_at,source)
       VALUES($1,$2,$3,$4,$5)
       RETURNING id,space_id,post_id,media_asset_id,occurred_at,source,created_at`,
      [spaceId,postId,mediaAssetId,occurredAt,source],
    );
    return { entityType: 'timeline_entry', ...inserted.rows[0] };
  }


  private async addAlbumItem(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['spaceId','albumId','mediaAssetId','caption','occurredAt'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const { spaceId, albumId, mediaAssetId } = payload;
    if (![spaceId,albumId,mediaAssetId].every(value => typeof value === 'string' && UUID.test(value as string))) throw new Error('INVALID_ALBUM_ITEM');
    const caption = payload.caption ?? null;
    if (caption !== null && (typeof caption !== 'string' || caption.length > 500)) throw new Error('INVALID_CAPTION');
    const occurredAt = payload.occurredAt ?? new Date().toISOString();
    if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) throw new Error('INVALID_OCCURRED_AT');
    const album = await client.query(
      `SELECT a.id,a.visibility,sm.role FROM space_albums a
       JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
       JOIN spaces s ON s.id=a.space_id AND s.status='active'
       WHERE a.id=$2 AND a.space_id=$3 FOR SHARE OF a,sm,s`,
      [userId,albumId,spaceId]);
    if (!album.rowCount || album.rows[0].role === 'guest' ||
      (album.rows[0].visibility === 'admins' && !['owner','admin','moderator'].includes(String(album.rows[0].role)))) {
      throw new Error('ALBUM_ACCESS_DENIED');
    }
    const media = await client.query(
      `SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready' FOR SHARE`,
      [mediaAssetId,userId]);
    if (!media.rowCount) throw new Error('MEDIA_NOT_READY_OR_NOT_OWNED');
    const inserted = await client.query(
      `INSERT INTO space_album_items(album_id,media_asset_id,added_by,caption,occurred_at)
       VALUES($1,$2,$3,$4,$5) ON CONFLICT(album_id,media_asset_id) DO NOTHING
       RETURNING id,album_id,media_asset_id,added_by,caption,occurred_at,created_at`,
      [albumId,mediaAssetId,userId,caption,occurredAt]);
    if (!inserted.rowCount) throw new Error('ALBUM_ITEM_ALREADY_EXISTS');
    await client.query(
      `INSERT INTO timeline_entries(space_id,media_asset_id,occurred_at,source)
       VALUES($1,$2,$3,'upload')`,[spaceId,mediaAssetId,occurredAt]);
    await client.query(
      `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
       VALUES($1,$2,'album.item_added','album_item',$3)`,[spaceId,userId,inserted.rows[0].id]);
    return { entityType:'album_item', ...inserted.rows[0] };
  }

  private async removeAlbumItem(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['spaceId','albumId','itemId'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const { spaceId,albumId,itemId } = payload;
    if (![spaceId,albumId,itemId].every(value => typeof value === 'string' && UUID.test(value as string))) throw new Error('INVALID_ALBUM_ITEM');
    const found = await client.query(
      `SELECT i.id,i.added_by,sm.role FROM space_album_items i
       JOIN space_albums a ON a.id=i.album_id
       JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
       WHERE a.space_id=$2 AND a.id=$3 AND i.id=$4 AND i.status='active'
       FOR UPDATE OF i,sm`,[userId,spaceId,albumId,itemId]);
    if (!found.rowCount || (found.rows[0].added_by !== userId &&
      !['owner','admin','moderator'].includes(String(found.rows[0].role)))) throw new Error('ALBUM_ITEM_NOT_REMOVABLE');
    await client.query(`UPDATE space_album_items SET status='removed',removed_at=now() WHERE id=$1`,[itemId]);
    await client.query(
      `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
       VALUES($1,$2,'album.item_removed','album_item',$3)`,[spaceId,userId,itemId]);
    return { entityType:'album_item',id:itemId,removed:true };
  }


  private async setEventRsvp(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => !['spaceId','response','guestCount','note'].includes(key))) throw new Error('INVALID_PAYLOAD');
    const { spaceId } = payload;
    const response = String(payload.response ?? '');
    const guestCount = payload.guestCount ?? 0;
    const note = payload.note ?? null;
    if (typeof spaceId !== 'string' || !UUID.test(spaceId)) throw new Error('INVALID_SPACE_ID');
    if (!['going','interested','declined'].includes(response)) throw new Error('INVALID_RSVP_RESPONSE');
    if (response !== 'going' && Number(guestCount) !== 0) throw new Error('GUESTS_REQUIRE_GOING_RSVP');
    if (!Number.isInteger(guestCount) || Number(guestCount)<0 || Number(guestCount)>20) throw new Error('INVALID_GUEST_COUNT');
    if (note !== null && (typeof note !== 'string' || note.length>500)) throw new Error('INVALID_RSVP_NOTE');
    const event = await client.query(
      `SELECT s.id,e.ends_at FROM spaces s
       JOIN event_details e ON e.space_id=s.id
       JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$2 AND sm.state='active'
       WHERE s.id=$1 AND s.type='EVENT' AND s.status='active'
       FOR SHARE OF s,sm`,[spaceId,userId]);
    if (!event.rowCount) throw new Error('EVENT_NOT_FOUND_OR_NOT_MEMBER');
    if (event.rows[0].ends_at && new Date(event.rows[0].ends_at).getTime() < Date.now()) throw new Error('EVENT_ALREADY_ENDED');
    const result = await client.query(
      `INSERT INTO event_rsvps(space_id,user_id,response,guest_count,note,responded_at)
       VALUES($1,$2,$3,$4,$5,now())
       ON CONFLICT(space_id,user_id) DO UPDATE SET
         response=EXCLUDED.response,guest_count=EXCLUDED.guest_count,
         note=EXCLUDED.note,responded_at=now()
       RETURNING id,space_id,user_id,response,guest_count,note,responded_at`,
      [spaceId,userId,response,guestCount,note]);
    return { entityType:'event_rsvp', ...result.rows[0] };
  }

  private async removeEventRsvp(client: any, userId: string, payload: Record<string, unknown>) {
    if (Object.keys(payload).some(key => key !== 'spaceId')) throw new Error('INVALID_PAYLOAD');
    const spaceId=payload.spaceId;
    if (typeof spaceId!=='string'||!UUID.test(spaceId)) throw new Error('INVALID_SPACE_ID');
    const result=await client.query(
      `DELETE FROM event_rsvps r USING spaces s,space_memberships sm
       WHERE r.space_id=$1 AND r.user_id=$2 AND s.id=r.space_id
         AND s.type='EVENT' AND sm.space_id=s.id AND sm.user_id=$2 AND sm.state='active'
       RETURNING r.id,r.space_id`,[spaceId,userId]);
    return { entityType:'event_rsvp',spaceId,removed:!!result.rowCount };
  }


  private decodeJournalBytes(value: unknown, min: number, max: number, code: string): Buffer {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error(code);
    const bytes=Buffer.from(value,'base64');
    if (bytes.toString('base64')!==value || bytes.length<min || bytes.length>max) throw new Error(code);
    return bytes;
  }

  private async assertCoupleJournalWrite(client: any, userId: string, spaceId: unknown, keyVersion: number | null) {
    if (typeof spaceId!=='string' || !UUID.test(spaceId)) throw new Error('INVALID_SPACE_ID');
    const entitlement=await client.query(
      `SELECT COALESCE(p.features->>'couple_journal','true')::boolean AS enabled
       FROM subscription_plans p
       LEFT JOIN LATERAL (
         SELECT us.plan_id FROM user_subscriptions us
         WHERE us.user_id=$1 AND us.status IN ('trialing','active','past_due')
           AND (us.current_period_end IS NULL OR us.current_period_end>now())
         ORDER BY CASE us.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
                  us.created_at DESC LIMIT 1
       ) s ON s.plan_id=p.id
       WHERE p.id=COALESCE(s.plan_id,(SELECT id FROM subscription_plans WHERE code='free'))`,
      [userId]);
    if(!entitlement.rowCount || entitlement.rows[0].enabled!==true) throw new Error('COUPLE_JOURNAL_NOT_INCLUDED_IN_PLAN');
    if (keyVersion!==null && (!Number.isSafeInteger(keyVersion)||keyVersion<1||keyVersion>1000000)) throw new Error('INVALID_KEY_VERSION');
    const space=await client.query(
      `SELECT s.id FROM spaces s
       JOIN space_memberships mine ON mine.space_id=s.id AND mine.user_id=$2 AND mine.state='active'
       WHERE s.id=$1 AND s.type='COUPLE' AND s.status='active'
         AND (SELECT count(*) FROM space_memberships m WHERE m.space_id=s.id AND m.state='active')=2
       FOR SHARE OF s,mine`,[spaceId,userId]);
    if(!space.rowCount) throw new Error('COUPLE_SPACE_ACCESS_DENIED');
    if (keyVersion===null) return;
    const envelopes=await client.query(
      `SELECT count(DISTINCT e.user_id)::int total
       FROM couple_space_key_envelopes e
       JOIN space_memberships m ON m.space_id=e.space_id AND m.user_id=e.user_id AND m.state='active'
       WHERE e.space_id=$1 AND e.key_version=$2`,[spaceId,keyVersion]);
    if(Number(envelopes.rows[0].total)!==2) throw new Error('COUPLE_KEY_NOT_SHARED');
  }

  private async createCoupleJournalEntry(client:any,userId:string,payload:Record<string,unknown>) {
    if(Object.keys(payload).some(k=>!['spaceId','ciphertext','nonce','keyVersion','encryptionVersion'].includes(k))) throw new Error('INVALID_PAYLOAD');
    const keyVersion=Number(payload.keyVersion??1);
    const encryptionVersion=payload.encryptionVersion??1;
    if(encryptionVersion!==1) throw new Error('UNSUPPORTED_ENCRYPTION_VERSION');
    const ciphertext=this.decodeJournalBytes(payload.ciphertext,1,65536,'INVALID_CIPHERTEXT');
    const nonce=this.decodeJournalBytes(payload.nonce,12,24,'INVALID_NONCE');
    await this.assertCoupleJournalWrite(client,userId,payload.spaceId,keyVersion);
    const result=await client.query(
      `INSERT INTO couple_journal_entries(space_id,author_id,ciphertext,nonce,encryption_version,key_version)
       VALUES($1,$2,$3,$4,1,$5)
       RETURNING id,space_id,author_id,key_version,created_at,updated_at`,
      [payload.spaceId,userId,ciphertext,nonce,keyVersion]);
    return {entityType:'couple_journal_entry',...result.rows[0]};
  }

  private async updateCoupleJournalEntry(client:any,userId:string,payload:Record<string,unknown>) {
    if(Object.keys(payload).some(k=>!['spaceId','entryId','ciphertext','nonce','keyVersion','encryptionVersion'].includes(k))) throw new Error('INVALID_PAYLOAD');
    if(typeof payload.entryId!=='string'||!UUID.test(payload.entryId)) throw new Error('INVALID_ENTRY_ID');
    const keyVersion=Number(payload.keyVersion??1);
    if((payload.encryptionVersion??1)!==1) throw new Error('UNSUPPORTED_ENCRYPTION_VERSION');
    const ciphertext=this.decodeJournalBytes(payload.ciphertext,1,65536,'INVALID_CIPHERTEXT');
    const nonce=this.decodeJournalBytes(payload.nonce,12,24,'INVALID_NONCE');
    await this.assertCoupleJournalWrite(client,userId,payload.spaceId,keyVersion);
    const result=await client.query(
      `UPDATE couple_journal_entries SET ciphertext=$4,nonce=$5,encryption_version=1,
         key_version=$6,updated_at=now()
       WHERE id=$1 AND space_id=$2 AND author_id=$3 AND deleted_at IS NULL
       RETURNING id,space_id,author_id,key_version,created_at,updated_at`,
      [payload.entryId,payload.spaceId,userId,ciphertext,nonce,keyVersion]);
    if(!result.rowCount) throw new Error('JOURNAL_ENTRY_NOT_OWNED');
    return {entityType:'couple_journal_entry',...result.rows[0]};
  }

  private async removeCoupleJournalEntry(client:any,userId:string,payload:Record<string,unknown>) {
    if(Object.keys(payload).some(k=>!['spaceId','entryId'].includes(k))) throw new Error('INVALID_PAYLOAD');
    if(typeof payload.entryId!=='string'||!UUID.test(payload.entryId)) throw new Error('INVALID_ENTRY_ID');
    await this.assertCoupleJournalWrite(client,userId,payload.spaceId,null);
    const result=await client.query(
      `UPDATE couple_journal_entries SET deleted_at=now(),updated_at=now()
       WHERE id=$1 AND space_id=$2 AND author_id=$3 AND deleted_at IS NULL
       RETURNING id`,[payload.entryId,payload.spaceId,userId]);
    if(!result.rowCount) throw new Error('JOURNAL_ENTRY_NOT_OWNED');
    return {entityType:'couple_journal_entry',id:result.rows[0].id,deleted:true};
  }

  async pull(userId: string, cursor?: string, limit = 200) {
    if (cursor !== undefined && !/^\d{1,18}$/.test(cursor)) {
      throw new BadRequestException('Sync cursor must be a non-negative integer.');
    }
    const requestedLimit = Number(limit);
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
      throw new BadRequestException('Sync limit must be a positive integer.');
    }
    const safeLimit = Math.min(requestedLimit, 500);
    const requestedCursor = cursor ?? '0';
    return this.db.transaction(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      const bounds = await client.query(
        `SELECT COALESCE(MIN(sequence_id),0)::text AS oldest_sequence,
                COALESCE(MAX(sequence_id),0)::text AS latest_sequence
         FROM sync_change_log WHERE user_id=$1`,
        [userId],
      );
      const oldest = BigInt(bounds.rows[0].oldest_sequence);
      const latest = BigInt(bounds.rows[0].latest_sequence);
      const requested = BigInt(requestedCursor);
      const cursorAhead = requested > latest;
      const historyExpired = oldest > 0n && requested < oldest - 1n;
      if (cursorAhead || historyExpired) {
        return {
          changes: [],
          nextCursor: requestedCursor,
          hasMore: false,
          resetRequired: true,
          resetReason: cursorAhead ? 'cursor_ahead' : 'history_expired',
          oldestCursor: oldest > 0n ? (oldest - 1n).toString() : '0',
          serverCursor: latest.toString(),
        };
      }
      const result = await client.query(
        `SELECT sequence_id,entity_type,entity_id,change_type,payload,occurred_at
         FROM sync_change_log
         WHERE user_id=$1 AND sequence_id>$2::bigint
         ORDER BY sequence_id ASC LIMIT $3`,
        [userId, requestedCursor, safeLimit],
      );
      const nextCursor = result.rowCount
        ? String(result.rows[result.rows.length - 1].sequence_id)
        : requestedCursor;
      return {
        changes: result.rows,
        nextCursor,
        hasMore: result.rowCount === safeLimit,
        resetRequired: false,
        serverCursor: latest.toString(),
      };
    });
  }

  async snapshot(userId: string, input?: unknown) {
    return this.db.transaction(async client => {
      // READ COMMITTED is intentional: each section query must see permission changes
      // committed before that query, rather than reusing a transaction-wide old snapshot.
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      // Shared global lock allows concurrent snapshots but orders them against
      // every authorization-changing write guarded by migration 0064.
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      // Keep same-user snapshot creation/continuation serialized independently.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [userId]);
      await client.query(`DELETE FROM sync_snapshot_sessions WHERE expires_at <= now() OR created_at < now()-interval '24 hours'`);
    if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input))) {
      throw new BadRequestException('Snapshot input must be an object.');
    }
    const value = (input ?? {}) as Record<string, unknown>;
    if (Object.keys(value).some(key => !['sections','limit','offsets','snapshotId'].includes(key))) {
      throw new BadRequestException('Unsupported snapshot fields.');
    }
    const snapshotId = value.snapshotId;
    if (snapshotId !== undefined && (typeof snapshotId !== 'string' || !UUID.test(snapshotId))) throw new BadRequestException('snapshotId must be a UUID.');
    const allowed = ['profile','relationships','blocks','spaces','posts','comments','reactions','timeline','albums','notifications','notificationPreferences','devices','rsvps','coupleJournal','coupleKeyEnvelopes','media'];
    let requested = value.sections === undefined ? allowed
      : Array.isArray(value.sections) && value.sections.every(item => typeof item === 'string' && allowed.includes(item))
        ? [...new Set(value.sections as string[])] : null;
    if (!requested) throw new BadRequestException('Invalid snapshot sections.');
    // A continuation must never serve previously materialized authorization-sensitive data.
    // Rebuild every requested section from current database permissions on every page.
    // This trades strict point-in-time pagination for fail-closed authorization freshness.
    let continuationSnapshotId: string | null = null;
    let frozenData: Record<string, unknown[]> | null = null;
    let frozenCursor: string | null = null;
    if (snapshotId) {
      const saved = await client.query(
        `SELECT sections FROM sync_snapshot_sessions
         WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE`,
        [snapshotId,userId],
      );
      if (!saved.rowCount) throw new BadRequestException('Snapshot session not found or expired.');
      const savedSections = saved.rows[0].sections as string[];
      if (value.sections !== undefined && JSON.stringify(requested) !== JSON.stringify(savedSections)) {
        throw new BadRequestException('Snapshot sections cannot change during pagination.');
      }
      requested = savedSections;
      continuationSnapshotId = String(snapshotId);
      await client.query(
        `DELETE FROM sync_snapshot_sessions WHERE id=$1 AND user_id=$2`,
        [snapshotId,userId],
      );
    }
    const requestedLimit = value.limit === undefined ? 500 : value.limit;
    if (!Number.isSafeInteger(requestedLimit) || Number(requestedLimit) < 1 || Number(requestedLimit) > 1000) {
      throw new BadRequestException('Snapshot limit must be an integer between 1 and 1000.');
    }
    const limit = Number(requestedLimit);
    const rawOffsets = value.offsets === undefined ? {} : value.offsets;
    if (!rawOffsets || typeof rawOffsets !== 'object' || Array.isArray(rawOffsets)) {
      throw new BadRequestException('Snapshot offsets must be an object keyed by section.');
    }
    const offsets: Record<string, number> = {};
    for (const [section, offset] of Object.entries(rawOffsets as Record<string, unknown>)) {
      if (!allowed.includes(section) || !Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 10000000) {
        throw new BadRequestException('Invalid snapshot section offset.');
      }
      offsets[section] = Number(offset);
    }
    if (Object.keys(offsets).some(section => !requested.includes(section))) {
      throw new BadRequestException('Snapshot offsets must belong to requested sections.');
    }
    // Capture the change-feed watermark before reading section data. If a write
    // commits while sections are being materialized, its sequence must remain
    // above this cursor so the next pull can deliver it (duplicates are safe).
    const cursor = await client.query(
      `SELECT COALESCE(MAX(sequence_id),0)::text AS cursor FROM sync_change_log WHERE user_id=$1`, [userId]);
    const nextOffsets: Record<string, number> = {};
    const data: Record<string, unknown[]> = frozenData ?? {};
    const has = (section: string) => !frozenData && requested.includes(section);

    if (has('spaces')) {
      const r = await client.query(
        `SELECT s.id,s.type,s.owner_id,s.name,s.visibility,s.status,s.settings,s.created_at,s.updated_at,
                m.role,m.state,m.joined_at,
                CASE WHEN s.type='EVENT' THEN jsonb_build_object(
                  'startsAt',e.starts_at,'endsAt',e.ends_at,'timezone',e.timezone,
                  'moderationMode',e.moderation_mode,'downloadPolicy',e.download_policy)
                WHEN s.type='CIRCLE' THEN jsonb_build_object(
                  'description',c.description,'joinPolicy',c.join_policy)
                WHEN s.type='COUPLE' THEN jsonb_build_object(
                  'anniversaryDate',p.anniversary_date,'settings',p.settings) ELSE '{}'::jsonb END AS details
         FROM space_memberships m JOIN spaces s ON s.id=m.space_id
         LEFT JOIN event_details e ON e.space_id=s.id
         LEFT JOIN circle_details c ON c.space_id=s.id
         LEFT JOIN couple_details p ON p.space_id=s.id
         WHERE m.user_id=$1 AND m.state='active'
         ORDER BY s.created_at DESC,s.id`, [userId]);
      data.spaces = r.rows;
    }
    if (has('posts')) {
      const r = await client.query(
        `SELECT p.id,p.author_id,p.space_id,p.media_asset_id,p.body,p.audience,p.status,p.created_at,p.published_at,p.updated_at
         FROM posts p
         WHERE p.status='published' AND (
           p.author_id=$1 OR p.audience='public'
           OR (p.audience='followers' AND EXISTS(
             SELECT 1 FROM user_relationships rel WHERE rel.requester_id=$1 AND rel.target_id=p.author_id AND rel.state='accepted'))
           OR (p.audience='space' AND EXISTS(
             SELECT 1 FROM space_memberships sm WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'))
         ) AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
         ORDER BY p.created_at DESC,p.id`, [userId]);
      data.posts = r.rows;
    }
    if (has('comments')) {
      const r = await client.query(
        `SELECT c.id,c.post_id,c.author_id,c.body,c.status,c.created_at
         FROM post_comments c JOIN posts p ON p.id=c.post_id
         WHERE c.status='visible' AND p.status='published' AND (
           p.author_id=$1 OR p.audience='public'
           OR (p.audience='followers' AND EXISTS(
             SELECT 1 FROM user_relationships rel WHERE rel.requester_id=$1 AND rel.target_id=p.author_id AND rel.state='accepted'))
           OR (p.audience='space' AND EXISTS(
             SELECT 1 FROM space_memberships sm WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'))
         ) AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$1 AND b.blocked_id=c.author_id) OR (b.blocker_id=c.author_id AND b.blocked_id=$1))
         ORDER BY c.created_at DESC,c.id`, [userId]);
      data.comments = r.rows;
    }
    if (has('timeline')) {
      const r = await client.query(
        `SELECT t.id,t.space_id,t.post_id,t.media_asset_id,t.occurred_at,t.source,t.created_at
         FROM timeline_entries t JOIN space_memberships m ON m.space_id=t.space_id
         JOIN spaces s ON s.id=t.space_id
         WHERE m.user_id=$1 AND m.state='active' AND s.status='active'
           AND (t.post_id IS NULL OR EXISTS(
             SELECT 1 FROM posts p
             WHERE p.id=t.post_id AND p.status='published'
               AND (
                 p.author_id=$1 OR p.audience='public'
                 OR (p.audience='followers' AND EXISTS(
                   SELECT 1 FROM user_relationships rel
                   WHERE rel.requester_id=$1 AND rel.target_id=p.author_id AND rel.state='accepted'))
                 OR (p.audience='space' AND EXISTS(
                   SELECT 1 FROM space_memberships pm
                   WHERE pm.space_id=p.space_id AND pm.user_id=$1 AND pm.state='active'))
               )
               AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                 (b.blocker_id=$1 AND b.blocked_id=p.author_id)
                 OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
           ))
           AND (t.media_asset_id IS NULL OR EXISTS(
             SELECT 1 FROM media_assets a WHERE a.id=t.media_asset_id AND a.status='ready'
               AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                 (b.blocker_id=$1 AND b.blocked_id=a.owner_id)
                 OR (b.blocker_id=a.owner_id AND b.blocked_id=$1))
           ))
         ORDER BY t.occurred_at DESC,t.id`, [userId]);
      data.timeline = r.rows;
    }
    if (has('albums')) {
      const r = await client.query(
        `SELECT a.id AS album_id,a.space_id,a.name,a.description,a.visibility,
                i.id AS item_id,i.media_asset_id,i.added_by,i.caption,i.occurred_at,i.status,i.created_at
         FROM space_albums a JOIN space_memberships m ON m.space_id=a.space_id
         LEFT JOIN space_album_items i ON i.album_id=a.id AND i.status='active'
           AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
             (b.blocker_id=$1 AND b.blocked_id=i.added_by)
             OR (b.blocker_id=i.added_by AND b.blocked_id=$1))
           AND EXISTS(SELECT 1 FROM media_assets ma WHERE ma.id=i.media_asset_id AND ma.status='ready'
             AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
               (b.blocker_id=$1 AND b.blocked_id=ma.owner_id)
               OR (b.blocker_id=ma.owner_id AND b.blocked_id=$1)))
         WHERE m.user_id=$1 AND m.state='active'
           AND (a.visibility='members' OR m.role IN ('owner','admin','moderator'))
         ORDER BY a.created_at DESC,i.occurred_at DESC NULLS LAST,i.id`, [userId]);
      data.albums = r.rows;
    }
    if (has('notifications')) {
      const r = await client.query(
        `SELECT id,category,payload,read_at,created_at FROM notifications
         WHERE user_id=$1 ORDER BY created_at DESC,id`, [userId]);
      data.notifications = r.rows;
    }
    if (has('rsvps')) {
      const r = await client.query(
        `SELECT r.id,r.space_id,r.response,r.guest_count,r.note,r.responded_at
         FROM event_rsvps r JOIN space_memberships m ON m.space_id=r.space_id AND m.user_id=r.user_id
         WHERE r.user_id=$1 AND m.state='active'
         ORDER BY r.responded_at DESC,r.id`, [userId]);
      data.rsvps = r.rows;
    }
    if (has('coupleJournal')) {
      const r = await client.query(
        `SELECT j.id,j.space_id,j.author_id,encode(j.ciphertext,'base64') AS ciphertext,
                encode(j.nonce,'base64') AS nonce,j.encryption_version,j.created_at,j.updated_at
         FROM couple_journal_entries j
         JOIN space_memberships m ON m.space_id=j.space_id AND m.user_id=$1
         JOIN spaces s ON s.id=j.space_id AND s.type='COUPLE' AND s.status='active'
         WHERE m.state='active' AND j.deleted_at IS NULL
         ORDER BY j.created_at DESC,j.id`, [userId]);
      data.coupleJournal = r.rows;
    }
    if (has('media')) {
      const r = await client.query(
        `SELECT a.id,a.mime_type_detected,a.size_bytes,a.width,a.height,a.checksum_sha256,
                a.status,a.created_at,a.processing_completed_at
         FROM media_assets a WHERE a.owner_id=$1 AND a.status <> 'deleted'
         ORDER BY a.created_at DESC,a.id`, [userId]);
      data.media = r.rows;
    }
    if (has('profile')) {
      const r = await client.query(
        `SELECT u.id AS user_id,p.display_name,p.bio,p.avatar_media_id,p.visibility,p.preferences,
                p.created_at,p.updated_at
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
         WHERE u.id=$1 AND u.status IN ('active','deletion_pending')`, [userId]);
      data.profile = r.rows;
    }
    if (has('relationships')) {
      const r = await client.query(
        `SELECT id,requester_id,target_id,state,created_at,updated_at
         FROM user_relationships WHERE requester_id=$1 OR target_id=$1
         ORDER BY created_at DESC,id`, [userId]);
      data.relationships = r.rows;
    }
    if (has('blocks')) {
      const r = await client.query(
        `SELECT md5(blocker_id::text || ':' || blocked_id::text)::uuid AS id,
                blocker_id,blocked_id,created_at
         FROM user_blocks
         WHERE blocker_id=$1 OR blocked_id=$1
         ORDER BY created_at DESC,blocker_id,blocked_id`,
        [userId],
      );
      data.blocks = r.rows;
    }
    if (has('reactions')) {
      const r = await client.query(
        `SELECT r.id,r.target_type,r.target_id,r.reaction_type,r.created_at
         FROM content_reactions r
         WHERE r.user_id=$1 AND (
           (r.target_type='post' AND EXISTS(SELECT 1 FROM posts p WHERE p.id=r.target_id AND p.status='published'
             AND (p.author_id=$1 OR p.audience='public'
               OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships rel
                 WHERE rel.requester_id=$1 AND rel.target_id=p.author_id AND rel.state='accepted'))
               OR (p.audience='space' AND EXISTS(SELECT 1 FROM space_memberships sm
                 WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active')))
             AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
               (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR
               (b.blocker_id=p.author_id AND b.blocked_id=$1)))
           OR (r.target_type='comment' AND EXISTS(SELECT 1 FROM post_comments c JOIN posts p ON p.id=c.post_id
             WHERE c.id=r.target_id AND c.status='visible' AND p.status='published'
               AND (p.author_id=$1 OR p.audience='public'
                 OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships rel
                   WHERE rel.requester_id=$1 AND rel.target_id=p.author_id AND rel.state='accepted'))
                 OR (p.audience='space' AND EXISTS(SELECT 1 FROM space_memberships sm
                   WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active')))
               AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                 (b.blocker_id=$1 AND b.blocked_id=c.author_id) OR
                 (b.blocker_id=c.author_id AND b.blocked_id=$1))
               AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                 (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR
                 (b.blocker_id=p.author_id AND b.blocked_id=$1)))
         ) ORDER BY r.created_at DESC,r.id`, [userId]);
      data.reactions = r.rows;
    }
    if (has('notificationPreferences')) {
      const r = await client.query(
        `SELECT category,in_app_enabled,push_enabled,updated_at
         FROM notification_preferences WHERE user_id=$1 ORDER BY category`, [userId]);
      data.notificationPreferences = r.rows;
    }
    if (has('devices')) {
      const r = await client.query(
        `SELECT id,platform,last_seen_at,revoked_at,created_at
         FROM devices WHERE user_id=$1 ORDER BY created_at DESC,id`, [userId]);
      data.devices = r.rows;
    }
    if (has('coupleKeyEnvelopes')) {
      const r = await client.query(
        `SELECT e.id,e.space_id,e.key_version,e.algorithm,
                encode(e.encrypted_key,'base64') AS encrypted_key,
                encode(e.nonce,'base64') AS nonce,e.created_at,e.updated_at
         FROM couple_space_key_envelopes e
         JOIN space_memberships m ON m.space_id=e.space_id AND m.user_id=e.user_id
         JOIN spaces s ON s.id=e.space_id AND s.type='COUPLE' AND s.status='active'
         WHERE e.user_id=$1 AND m.state='active'
         ORDER BY e.space_id,e.key_version DESC`, [userId]);
      data.coupleKeyEnvelopes = r.rows;
    }
    let cursorValue: string | null = frozenCursor;
    let snapshotAt: unknown = null;
    let activeSnapshotId: string | null = snapshotId ?? null;
    if (!frozenData) {
      const totalRows = Object.values(data).reduce((sum, rows) => sum + rows.length, 0);
      if (totalRows > 25000 || Buffer.byteLength(JSON.stringify(data)) > 24 * 1024 * 1024) throw new BadRequestException('Snapshot exceeds the maximum materialized size; request fewer sections.');
      cursorValue = String(cursor.rows[0].cursor);
      const saved = continuationSnapshotId
        ? await client.query(
            `INSERT INTO sync_snapshot_sessions(id,user_id,sections,data,cursor,expires_at)
             VALUES($1,$2,$3::text[],$4::jsonb,$5::bigint,now()+interval '30 minutes')
             RETURNING id,created_at`,
            [continuationSnapshotId,userId,requested,JSON.stringify(data),cursorValue],
          )
        : await client.query(
            `INSERT INTO sync_snapshot_sessions(user_id,sections,data,cursor,expires_at)
             VALUES($1,$2::text[],$3::jsonb,$4::bigint,now()+interval '30 minutes')
             RETURNING id,created_at`,
            [userId,requested,JSON.stringify(data),cursorValue],
          );
      activeSnapshotId = String(saved.rows[0].id);
      snapshotAt = saved.rows[0].created_at;
      const excess = await client.query(
        `SELECT id FROM sync_snapshot_sessions WHERE user_id=$1 AND id<>$2
         ORDER BY created_at DESC OFFSET 2`,
        [userId,activeSnapshotId],
      );
      if (excess.rowCount) await client.query(
        `DELETE FROM sync_snapshot_sessions WHERE user_id=$1 AND id=ANY($2::uuid[])`,
        [userId,excess.rows.map(row => row.id)],
      );
    } else {
      snapshotAt = (await client.query(
        `SELECT created_at FROM sync_snapshot_sessions WHERE id=$1 AND user_id=$2`,
        [snapshotId,userId],
      )).rows[0]?.created_at ?? null;
    }
    for (const section of requested) {
      const rows = data[section] ?? [];
      const offset = offsets[section] ?? 0;
      data[section] = rows.slice(offset,offset+limit);
      if (offset+limit < rows.length) nextOffsets[section] = offset+limit;
    }
    return {
      snapshotId: activeSnapshotId, data, limit, sections: requested, nextOffsets,
      hasMore: Object.keys(nextOffsets).length > 0,
      cursor: cursorValue, snapshotAt, expiresInSeconds: 1800,
      consistency: 'authorization_revalidated_materialization', generatedAt: new Date().toISOString(),
    };
    });
  }

  async releaseSnapshot(userId: string, snapshotId: string) {
    if (!UUID.test(snapshotId)) throw new BadRequestException('snapshotId must be a UUID.');
    const result = await this.db.query(
      `DELETE FROM sync_snapshot_sessions WHERE id=$1 AND user_id=$2 RETURNING id`,
      [snapshotId,userId],
    );
    return { released: result.rowCount === 1 };
  }

  async saveCheckpoint(userId:string,input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Checkpoint data is required.');
    const value=input as Record<string,unknown>;
    if(Object.keys(value).some(k=>!['deviceId','cursor'].includes(k))) throw new BadRequestException('Unsupported checkpoint fields.');
    const deviceId=value.deviceId,cursor=value.cursor;
    if(typeof deviceId!=='string'||!UUID.test(deviceId)) throw new BadRequestException('deviceId must be a UUID.');
    if(typeof cursor!=='string'||!/^\d{1,18}$/.test(cursor)) throw new BadRequestException('cursor must be a non-negative integer string.');
    return this.db.transaction(async client=>{
      const device=await client.query(
        `SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE`,[deviceId,userId]);
      if(!device.rowCount) throw new BadRequestException('Active device not found.');
      const latest=await client.query(
        `SELECT COALESCE(MAX(sequence_id),0)::text value FROM sync_change_log WHERE user_id=$1`,[userId]);
      if(BigInt(cursor)>BigInt(latest.rows[0].value)) throw new BadRequestException('Checkpoint cannot exceed the server cursor.');
      const saved=await client.query(
        `INSERT INTO sync_device_cursors(device_id,user_id,last_sequence_id,updated_at)
         VALUES($1,$2,$3::bigint,now())
         ON CONFLICT(device_id) DO UPDATE SET
           last_sequence_id=GREATEST(sync_device_cursors.last_sequence_id,EXCLUDED.last_sequence_id),
           updated_at=now()
         WHERE sync_device_cursors.user_id=EXCLUDED.user_id
         RETURNING device_id,last_sequence_id::text,updated_at`,
        [deviceId,userId,cursor]);
      if(!saved.rowCount) throw new BadRequestException('Device checkpoint ownership conflict.');
      return saved.rows[0];
    });
  }

  async getDeviceSyncStatus(userId: string, deviceId: string) {
    if (!UUID.test(deviceId)) throw new BadRequestException('deviceId must be a UUID.');
    const result = await this.db.query(
      `SELECT d.id,d.platform,d.last_seen_at,d.revoked_at,
              COALESCE(c.last_sequence_id,0)::text AS device_cursor,
              COALESCE(bounds.oldest_sequence,0)::text AS oldest_sequence,
              COALESCE(bounds.latest_sequence,0)::text AS latest_sequence
       FROM devices d
       LEFT JOIN sync_device_cursors c ON c.device_id=d.id AND c.user_id=d.user_id
       CROSS JOIN LATERAL (
         SELECT MIN(sequence_id) AS oldest_sequence,MAX(sequence_id) AS latest_sequence
         FROM sync_change_log WHERE user_id=$2
       ) bounds
       WHERE d.id=$1 AND d.user_id=$2`,
      [deviceId,userId],
    );
    if (!result.rowCount || result.rows[0].revoked_at) {
      throw new BadRequestException('Active device not found.');
    }
    const row = result.rows[0];
    const cursor = BigInt(String(row.device_cursor));
    const oldest = BigInt(String(row.oldest_sequence));
    const latest = BigInt(String(row.latest_sequence));
    const historyExpired = oldest > 0n && cursor < oldest - 1n;
    const cursorAhead = cursor > latest;
    return {
      deviceId: row.id,
      platform: row.platform,
      lastSeenAt: row.last_seen_at,
      cursor: cursor.toString(),
      oldestCursor: oldest > 0n ? (oldest - 1n).toString() : '0',
      serverCursor: latest.toString(),
      resetRequired: historyExpired || cursorAhead,
      resetReason: cursorAhead ? 'cursor_ahead' : historyExpired ? 'history_expired' : null,
      recommendedAction: historyExpired || cursorAhead ? 'snapshot' : 'pull',
    };
  }

  private errorCode(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'SYNC_OPERATION_FAILED';
  }
}
