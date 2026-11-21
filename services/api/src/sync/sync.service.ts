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
      if (!['post.create', 'timeline.add'].includes(String(value.type))) throw new BadRequestException('Unsupported sync operation type.');
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

          const created = operation.type === 'post.create'
            ? await this.createPost(client, userId, operation.payload)
            : await this.addTimelineEntry(client, userId, operation.payload);
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
        `SELECT 1 FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id
         WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active' AND s.status='active' FOR SHARE OF sm,s`,
        [spaceId,userId],
      );
      if (!member.rowCount) throw new Error('SPACE_ACCESS_DENIED');
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
      `SELECT 1 FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id
       WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active' AND s.status='active' FOR SHARE OF sm,s`,
      [spaceId,userId],
    );
    if (!membership.rowCount) throw new Error('SPACE_ACCESS_DENIED');
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
