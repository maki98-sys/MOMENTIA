import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

type SyncOperation = { operationId: string; type: string; payload: Record<string, unknown> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SyncService {
  constructor(private readonly db: DatabaseService) {}

  private parseOperations(input: unknown): SyncOperation[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Sync payload is required.');
    const operations = (input as Record<string, unknown>).operations;
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) {
      throw new BadRequestException('Provide between 1 and 50 operations.');
    }
    return operations.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new BadRequestException('Invalid sync operation.');
      const value = item as Record<string, unknown>;
      if (!UUID.test(String(value.operationId ?? ''))) throw new BadRequestException('operationId must be a UUID.');
      if (!['post.create', 'timeline.add', 'comment.create', 'comment.update', 'comment.remove', 'reaction.set', 'reaction.remove', 'album.item.add', 'album.item.remove', 'event.rsvp.set', 'event.rsvp.remove'].includes(String(value.type))) throw new BadRequestException('Unsupported sync operation type.');
      if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new BadRequestException('Operation payload is required.');
      return { operationId: String(value.operationId), type: String(value.type), payload: value.payload as Record<string, unknown> };
    });
  }

  async push(userId: string, input: unknown) {
    const operations = this.parseOperations(input);
    const results = [];
    for (const operation of operations) {
      try {
        const result = await this.db.transaction(async client => {
          const receipt = await client.query(
            `INSERT INTO sync_operation_receipts(user_id,operation_id,operation_type)
             VALUES($1,$2,$3) ON CONFLICT(user_id,operation_id) DO NOTHING
             RETURNING id`,
            [userId, operation.operationId, operation.type],
          );
          if (!receipt.rowCount) {
            const previous = await client.query(
              `SELECT operation_type,state,result,error_code FROM sync_operation_receipts
               WHERE user_id=$1 AND operation_id=$2`,
              [userId, operation.operationId],
            );
            const row = previous.rows[0];
            if (row.operation_type !== operation.type) return { operationId: operation.operationId, state: 'rejected', errorCode: 'IDEMPOTENCY_KEY_REUSED' };
            if (row.state === 'succeeded') return { operationId: operation.operationId, state: 'succeeded', result: row.result, replayed: true };
            if (row.state === 'rejected') return { operationId: operation.operationId, state: 'rejected', errorCode: row.error_code, replayed: true };
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
          else created = await this.removeEventRsvp(client, userId, operation.payload);
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
          `INSERT INTO sync_operation_receipts(user_id,operation_id,operation_type,state,error_code,completed_at)
           VALUES($1,$2,$3,'rejected',$4,now())
           ON CONFLICT(user_id,operation_id) DO NOTHING`,
          [userId, operation.operationId, operation.type, code],
        );
        results.push({ operationId: operation.operationId, state: 'rejected', errorCode: code });
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
      const post = await client.query(`SELECT id FROM posts WHERE id=$1 AND space_id=$2 AND status='published'`, [postId,spaceId]);
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
    if (!Number.isInteger(guestCount) || Number(guestCount)<0 || Number(guestCount)>20) throw new Error('INVALID_GUEST_COUNT');
    if (note !== null && (typeof note !== 'string' || note.length>500)) throw new Error('INVALID_RSVP_NOTE');
    const event = await client.query(
      `SELECT s.id,e.starts_at FROM spaces s
       JOIN event_details e ON e.space_id=s.id
       JOIN space_memberships sm ON sm.space_id=s.id AND sm.user_id=$2 AND sm.state='active'
       WHERE s.id=$1 AND s.type='EVENT' AND s.status='active'
       FOR SHARE OF s,sm`,[spaceId,userId]);
    if (!event.rowCount) throw new Error('EVENT_NOT_FOUND_OR_NOT_MEMBER');
    if (new Date(event.rows[0].starts_at).getTime() < Date.now()) throw new Error('EVENT_ALREADY_STARTED');
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

  async pull(userId: string, cursor?: string, limit = 200) {
    if (cursor !== undefined && !/^\d{1,18}$/.test(cursor)) throw new BadRequestException('Sync cursor must be a non-negative integer.');
    const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 500);
    const result = await this.db.query(
      `SELECT sequence_id,entity_type,entity_id,change_type,payload,occurred_at
       FROM sync_change_log WHERE user_id=$1 AND sequence_id>$2::bigint
       ORDER BY sequence_id ASC LIMIT $3`,
      [userId,cursor ?? '0',safeLimit],
    );
    const nextCursor = result.rowCount ? String(result.rows[result.rowCount - 1].sequence_id) : (cursor ?? '0');
    return { changes: result.rows, nextCursor, hasMore: result.rowCount === safeLimit };
  }

  private errorCode(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return /^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'SYNC_OPERATION_FAILED';
  }
}
