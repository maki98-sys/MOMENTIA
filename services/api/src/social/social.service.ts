import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class SocialService {
  constructor(private readonly db: DatabaseService) {}

  private validatePost(body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Post data is required.');
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(k => !['body','mediaAssetId','audience','spaceId'].includes(k))) throw new BadRequestException('Unsupported post fields.');
    const text = value.body === undefined ? null : value.body;
    if (text !== null && (typeof text !== 'string' || text.length > 5000)) throw new BadRequestException('Post text must be at most 5000 characters.');
    const mediaAssetId = value.mediaAssetId ?? null;
    if (mediaAssetId !== null && typeof mediaAssetId !== 'string') throw new BadRequestException('Invalid media asset.');
    const audience = value.audience ?? 'followers';
    if (!['public','followers','space','private'].includes(String(audience))) throw new BadRequestException('Invalid audience.');
    const spaceId = value.spaceId ?? null;
    if (audience === 'space' && typeof spaceId !== 'string') throw new BadRequestException('A space is required for space posts.');
    if (audience !== 'space' && spaceId !== null) throw new BadRequestException('spaceId is only valid for space posts.');
    if (!text && !mediaAssetId) throw new BadRequestException('A post needs text or a media asset.');
    return { body: text as string | null, mediaAssetId: mediaAssetId as string | null, audience: String(audience), spaceId: spaceId as string | null };
  }

  private assertDifferentUsers(actorId: string, targetId: string) {
    if (!targetId || actorId === targetId) throw new BadRequestException('You cannot perform this action on your own account.');
  }

  async follow(actorId: string, targetId: string) {
    this.assertDifferentUsers(actorId, targetId);
    return this.db.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const target = await client.query(
        `SELECT u.id, p.visibility FROM users u
         JOIN user_profiles p ON p.user_id=u.id
         WHERE u.id=$2 AND u.status='active'
           AND NOT EXISTS (SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id=$1 AND b.blocked_id=u.id)
                OR (b.blocker_id=u.id AND b.blocked_id=$1))
         FOR SHARE OF u, p`,
        [actorId,targetId],
      );
      if (!target.rowCount || target.rows[0].visibility === 'private') throw new NotFoundException('User not found.');
      const state = target.rows[0].visibility === 'public' ? 'accepted' : 'pending';
      const result = await client.query(
        `INSERT INTO user_relationships(requester_id,target_id,state)
         VALUES($1,$2,$3)
         ON CONFLICT(requester_id,target_id) DO UPDATE
           SET state=CASE WHEN user_relationships.state='accepted'
                          THEN 'accepted' ELSE EXCLUDED.state END,
               updated_at=now()
         RETURNING id,requester_id,target_id,state,created_at,updated_at`,
        [actorId,targetId,state],
      );
      return result.rows[0];
    });
  }

  async unfollow(actorId: string, targetId: string) {
    this.assertDifferentUsers(actorId,targetId);
    await this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      await client.query(`DELETE FROM user_relationships WHERE requester_id=$1 AND target_id=$2`,[actorId,targetId]);
    });
    return { following:false };
  }

  async listFollowRequests(userId: string) {
    const result=await this.db.query(
      `SELECT r.id,r.requester_id,r.created_at,p.display_name,p.avatar_media_id
       FROM user_relationships r
       JOIN users u ON u.id=r.requester_id AND u.status='active'
       LEFT JOIN user_profiles p ON p.user_id=r.requester_id
       WHERE r.target_id=$1 AND r.state='pending'
         AND NOT EXISTS (SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id=$1 AND b.blocked_id=r.requester_id)
              OR (b.blocker_id=r.requester_id AND b.blocked_id=$1))
       ORDER BY r.created_at ASC LIMIT 100`,
      [userId],
    );
    return result.rows;
  }

  async respondToFollowRequest(actorId: string, requesterId: string, decision: 'accepted'|'rejected') {
    this.assertDifferentUsers(actorId,requesterId);
    const result=await this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      return client.query(
        `UPDATE user_relationships r SET state=$3,updated_at=now()
         WHERE r.requester_id=$2 AND r.target_id=$1 AND r.state='pending'
           AND NOT EXISTS (SELECT 1 FROM user_blocks b
             WHERE (b.blocker_id=$1 AND b.blocked_id=$2)
                OR (b.blocker_id=$2 AND b.blocked_id=$1))
         RETURNING id,requester_id,target_id,state,updated_at`,
        [actorId,requesterId,decision],
      );
    });
    if(!result.rowCount) throw new NotFoundException('Pending follow request not found.');
    return result.rows[0];
  }

  async block(actorId: string, targetId: string) {
    this.assertDifferentUsers(actorId,targetId);
    return this.db.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const target=await client.query(`SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE`,[targetId]);
      if(!target.rowCount) throw new NotFoundException('User not found.');
      await client.query(
        `INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)
         ON CONFLICT(blocker_id,blocked_id) DO NOTHING`,
        [actorId,targetId],
      );
      await client.query(
        `DELETE FROM user_relationships
         WHERE (requester_id=$1 AND target_id=$2) OR (requester_id=$2 AND target_id=$1)`,
        [actorId,targetId],
      );
      return { blocked:true };
    });
  }

  async unblock(actorId: string, targetId: string) {
    this.assertDifferentUsers(actorId,targetId);
    await this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      await client.query(`DELETE FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2`,[actorId,targetId]);
    });
    return { blocked:false };
  }


  async listConnections(
    userId: string,
    kind: 'following' | 'followers' | 'requests',
    cursorValue?: string,
    requestedLimit = 20,
  ) {
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50.');
    }
    const cursor = cursorValue ? decodeConnectionCursor(cursorValue) : null;
    const result = await this.db.query<{
      relationship_id: string;
      created_at: Date | string;
      user_id: string;
      display_name: string | null;
      avatar_media_id: string | null;
    }>(
      `SELECT r.id AS relationship_id, r.created_at,
              u.id AS user_id, up.display_name, up.avatar_media_id
       FROM user_relationships r
       JOIN users viewer ON viewer.id = $1 AND viewer.status = 'active'
       JOIN users u
         ON u.id = CASE WHEN $2 = 'following' THEN r.target_id ELSE r.requester_id END
        AND u.status = 'active'
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE (
         ($2 = 'following' AND r.requester_id = $1 AND r.state = 'accepted')
         OR ($2 = 'followers' AND r.target_id = $1 AND r.state = 'accepted')
         OR ($2 = 'requests' AND r.target_id = $1 AND r.state = 'pending')
       )
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $1)
         )
         AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $5`,
      [userId, kind, cursor?.createdAt ?? null, cursor?.id ?? null, requestedLimit + 1],
    );
    const hasMore = result.rows.length > requestedLimit;
    const rows = result.rows.slice(0, requestedLimit);
    const users = rows.map(row => ({
      userId: row.user_id,
      displayName: row.display_name,
      avatarMediaId: row.avatar_media_id,
      createdAt: toIsoString(row.created_at),
    }));
    const last = rows[rows.length - 1];
    return {
      users,
      hasMore,
      nextCursor: hasMore && last
        ? encodeConnectionCursor({ createdAt: toIsoString(last.created_at), id: last.relationship_id })
        : null,
    };
  }

  async create(userId: string, input: unknown) {
    const v = this.validatePost(input);
    return this.db.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      if (v.mediaAssetId) {
        const media = await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`, [v.mediaAssetId,userId]);
        if (!media.rowCount) throw new NotFoundException('Media asset not found.');
      }
      if (v.spaceId) {
        const member = await client.query(`SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[v.spaceId,userId]);
        if (!member.rowCount || member.rows[0].role==='guest') throw new NotFoundException('Space not found.');
      }
      const result = await client.query(
        `INSERT INTO posts(author_id,body,media_asset_id,audience,space_id,status,published_at)
         VALUES($1,$2,$3,$4,$5,'published',now())
         RETURNING id,author_id,space_id,media_asset_id,body,audience,status,created_at,published_at`,
        [userId,v.body,v.mediaAssetId,v.audience,v.spaceId]);
      if(v.spaceId) {
        await client.query(
          `INSERT INTO timeline_entries(space_id,post_id,occurred_at,source)
           VALUES($1,$2,now(),'post')`,[v.spaceId,result.rows[0].id]);
      }
      return result.rows[0];
    });
  }

  async feed(userId: string, cursor?: string, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit)||20,1),50);
    let cursorAt: string | null = null;
    let cursorId: string | null = null;
    if(cursor!==undefined) {
      const parts=cursor.split('|');
      if(parts.length>2||Number.isNaN(Date.parse(parts[0]))||!Number.isFinite(Date.parse(parts[0]))) {
        throw new BadRequestException('Feed cursor must be an ISO date-time optionally followed by a post UUID.');
      }
      cursorAt=parts[0];
      if(parts[1]!==undefined) {
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parts[1])) {
          throw new BadRequestException('Feed cursor post id must be a UUID.');
        }
        cursorId=parts[1];
      }
    }
    const result = await this.db.query(
      `SELECT p.id,p.author_id,p.space_id,p.media_asset_id,p.body,p.audience,p.published_at,
              up.display_name,up.avatar_media_id,
              (SELECT count(*)::int FROM content_reactions r
               JOIN users reaction_author ON reaction_author.id=r.user_id AND reaction_author.status='active'
               WHERE r.target_type='post' AND r.target_id=p.id
                 AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                   (b.blocker_id=$1 AND b.blocked_id=r.user_id)
                   OR (b.blocker_id=r.user_id AND b.blocked_id=$1))) reaction_count,
              (SELECT count(*)::int FROM post_comments c
               JOIN users comment_author ON comment_author.id=c.author_id AND comment_author.status='active'
               WHERE c.post_id=p.id AND c.status='visible'
                 AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                   (b.blocker_id=$1 AND b.blocked_id=c.author_id)
                   OR (b.blocker_id=c.author_id AND b.blocked_id=$1))) comment_count
       FROM posts p JOIN users u ON u.id=p.author_id AND u.status='active'
       LEFT JOIN user_profiles up ON up.user_id=p.author_id
       WHERE p.status='published'
         AND ($2::timestamptz IS NULL OR
           ($3::uuid IS NULL AND p.published_at<$2::timestamptz) OR
           ($3::uuid IS NOT NULL AND (p.published_at,p.id)<($2::timestamptz,$3::uuid)))
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
         AND (p.author_id=$1 OR p.audience='public'
           OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships ur
               WHERE ur.requester_id=$1 AND ur.target_id=p.author_id AND ur.state='accepted'))
           OR (p.audience='space' AND EXISTS(SELECT 1 FROM spaces s WHERE s.id=p.space_id AND s.status IN ('active','archived'))
               AND EXISTS(SELECT 1 FROM space_memberships sm
               WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'))
           OR p.audience='private' AND p.author_id=$1)
       ORDER BY p.published_at DESC,p.id DESC LIMIT $4`,
      [userId,cursorAt,cursorId,safeLimit]);
    return result.rows;
  }

  async getPost(userId: string, postId: string) {
    return this.db.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      await this.assertCanView(userId, postId, client);
      const result = await client.query(
        `SELECT p.id,p.author_id,p.space_id,p.media_asset_id,p.body,p.audience,p.status,
                p.created_at,p.published_at,up.display_name,up.avatar_media_id,
                (SELECT count(*)::int FROM content_reactions r
                 JOIN users reaction_author ON reaction_author.id=r.user_id AND reaction_author.status='active'
                 WHERE r.target_type='post' AND r.target_id=p.id
                   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                     (b.blocker_id=$1 AND b.blocked_id=r.user_id)
                     OR (b.blocker_id=r.user_id AND b.blocked_id=$1))) reaction_count,
                (SELECT count(*)::int FROM post_comments c
                 JOIN users comment_author ON comment_author.id=c.author_id AND comment_author.status='active'
                 WHERE c.post_id=p.id AND c.status='visible'
                   AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                     (b.blocker_id=$1 AND b.blocked_id=c.author_id)
                     OR (b.blocker_id=c.author_id AND b.blocked_id=$1))) comment_count,
                (SELECT r.reaction_type FROM content_reactions r
                 WHERE r.target_type='post' AND r.target_id=p.id AND r.user_id=$1) my_reaction
         FROM posts p
         JOIN users author ON author.id=p.author_id AND author.status='active'
         LEFT JOIN user_profiles up ON up.user_id=p.author_id
         WHERE p.id=$2 AND p.status='published'`,
        [userId, postId],
      );
      if (!result.rowCount) throw new NotFoundException('Post not found.');
      return result.rows[0];
    });
  }

  async comments(userId: string, postId: string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      await this.assertCanView(userId,postId,client);
      const r=await client.query(`SELECT c.id,c.post_id,c.author_id,c.body,c.created_at,up.display_name
      FROM post_comments c JOIN users comment_author ON comment_author.id=c.author_id AND comment_author.status='active'
      LEFT JOIN user_profiles up ON up.user_id=c.author_id
      WHERE c.post_id=$1 AND c.status='visible'
        AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
          (b.blocker_id=$2 AND b.blocked_id=c.author_id)
          OR (b.blocker_id=c.author_id AND b.blocked_id=$2))
      ORDER BY c.created_at ASC LIMIT 200`,[postId,userId]);
      return r.rows;
    });
  }

  async addComment(userId: string, postId: string, body: unknown) {
    if(typeof body!=='string'||!body.trim()||body.length>3000) throw new BadRequestException('Comment must contain 1 to 3000 characters.');
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      await this.assertCanView(userId,postId,client);
      await this.assertCanInteract(userId,postId,client);
      const r=await client.query(`INSERT INTO post_comments(post_id,author_id,body) VALUES($1,$2,$3)
        RETURNING id,post_id,author_id,body,created_at`,[postId,userId,body.trim()]);
      return r.rows[0];
    });
  }

  async react(userId: string, postId: string, reaction: unknown) {
    if(!['like','love','laugh','wow','support'].includes(String(reaction))) throw new BadRequestException('Invalid reaction.');
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      await this.assertCanView(userId,postId,client);
      await this.assertCanInteract(userId,postId,client);
      const r=await client.query(`INSERT INTO content_reactions(target_type,target_id,user_id,reaction_type)
        VALUES('post',$1,$2,$3) ON CONFLICT(target_type,target_id,user_id)
        DO UPDATE SET reaction_type=EXCLUDED.reaction_type
        RETURNING id,target_id,reaction_type,created_at`,[postId,userId,reaction]);
      return r.rows[0];
    });
  }

  async removeReaction(userId: string, postId: string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      await this.assertCanView(userId,postId,client);
      await client.query(`DELETE FROM content_reactions WHERE target_type='post' AND target_id=$1 AND user_id=$2`,[postId,userId]);
      return { removed:true };
    });
  }

  async updateComment(userId: string, commentId: string, body: unknown) {
    if(typeof body!=='string'||!body.trim()||body.length>3000) {
      throw new BadRequestException('Comment must contain 1 to 3000 characters.');
    }
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const current=await client.query(
        `SELECT post_id FROM post_comments WHERE id=$1 AND author_id=$2 AND status='visible' FOR UPDATE`,
        [commentId,userId],
      );
      if(!current.rowCount) throw new NotFoundException('Comment not found.');
      await this.assertCanView(userId,String(current.rows[0].post_id),client);
      const result=await client.query(
        `UPDATE post_comments c SET body=$3
         WHERE c.id=$1 AND c.author_id=$2 AND c.status='visible'
           AND EXISTS (SELECT 1 FROM posts p WHERE p.id=c.post_id AND p.status='published')
         RETURNING c.id,c.post_id,c.author_id,c.body,c.created_at`,
        [commentId,userId,body.trim()],
      );
      if(!result.rowCount) throw new NotFoundException('Comment not found.');
      return result.rows[0];
    });
  }

  async deleteComment(userId: string, commentId: string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const current=await client.query(
        `SELECT post_id FROM post_comments WHERE id=$1 AND author_id=$2 AND status='visible' FOR UPDATE`,
        [commentId,userId],
      );
      if(!current.rowCount) throw new NotFoundException('Comment not found.');
      await this.assertCanView(userId,String(current.rows[0].post_id),client);
      const result=await client.query(
        `UPDATE post_comments c SET status='removed'
         WHERE c.id=$1 AND c.author_id=$2 AND c.status='visible'
           AND EXISTS (SELECT 1 FROM posts p WHERE p.id=c.post_id AND p.status='published')
         RETURNING c.id`,
        [commentId,userId],
      );
      if(!result.rowCount) throw new NotFoundException('Comment not found.');
      await client.query(`DELETE FROM content_reactions WHERE target_type='comment' AND target_id=$1`,[commentId]);
      return { removed:true, commentId };
    });
  }

  async reactToComment(userId: string, commentId: string, reaction: unknown) {
    if(!['like','love','laugh','wow','support'].includes(String(reaction))) {
      throw new BadRequestException('Invalid reaction.');
    }
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const visible=await client.query(
        `SELECT c.post_id FROM post_comments c JOIN users comment_author ON comment_author.id=c.author_id AND comment_author.status='active'
         WHERE c.id=$1 AND c.status='visible'
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
             (b.blocker_id=$2 AND b.blocked_id=c.author_id)
             OR (b.blocker_id=c.author_id AND b.blocked_id=$2))`,[commentId,userId]);
      if(!visible.rowCount) throw new NotFoundException('Comment not found.');
      await this.assertCanView(userId,String(visible.rows[0].post_id),client);
      await this.assertCanInteract(userId,String(visible.rows[0].post_id),client);
      const result=await client.query(
        `INSERT INTO content_reactions(target_type,target_id,user_id,reaction_type)
         VALUES('comment',$1,$2,$3)
         ON CONFLICT(target_type,target_id,user_id)
         DO UPDATE SET reaction_type=EXCLUDED.reaction_type
         RETURNING id,target_id,reaction_type,created_at`,
        [commentId,userId,reaction],
      );
      return result.rows[0];
    });
  }

  async removeCommentReaction(userId: string, commentId: string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const visible=await client.query(
        `SELECT c.post_id FROM post_comments c JOIN users comment_author ON comment_author.id=c.author_id AND comment_author.status='active'
         WHERE c.id=$1 AND c.status='visible'
           AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
             (b.blocker_id=$2 AND b.blocked_id=c.author_id)
             OR (b.blocker_id=c.author_id AND b.blocked_id=$2))`,[commentId,userId]);
      if(!visible.rowCount) throw new NotFoundException('Comment not found.');
      await this.assertCanView(userId,String(visible.rows[0].post_id),client);
      await this.assertCanInteract(userId,String(visible.rows[0].post_id),client);
      await client.query(
        `DELETE FROM content_reactions WHERE target_type='comment' AND target_id=$1 AND user_id=$2`,
        [commentId,userId],
      );
      return { removed:true };
    });
  }

  private async assertCanInteract(userId: string, postId: string, executor: {query:(sql:string,values?:unknown[])=>Promise<any>} = this.db) {
    const result=await executor.query(`SELECT p.audience,p.space_id,sm.role
      FROM posts p LEFT JOIN space_memberships sm
        ON sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'
      WHERE p.id=$2`,[userId,postId]);
    if(!result.rowCount) throw new NotFoundException('Post not found.');
    if(result.rows[0].audience==='space' && result.rows[0].role==='guest') {
      throw new NotFoundException('Post not found.');
    }
  }

  private async assertCanView(userId: string, postId: string, executor: {query:(sql:string,values?:unknown[])=>Promise<any>} = this.db) {
    const r=await executor.query(`SELECT 1 FROM posts p JOIN users post_author ON post_author.id=p.author_id AND post_author.status='active'
      WHERE p.id=$2 AND p.status='published'
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
      AND (p.author_id=$1 OR p.audience='public'
        OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships ur
          WHERE ur.requester_id=$1 AND ur.target_id=p.author_id AND ur.state='accepted'))
        OR (p.audience='space' AND EXISTS(SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active')))`,[userId,postId]);
    if(!r.rowCount) throw new NotFoundException('Post not found.');
  }
}

type ConnectionCursor = { createdAt: string; id: string };

function encodeConnectionCursor(cursor: ConnectionCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeConnectionCursor(value: string): ConnectionCursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new BadRequestException('cursor is invalid.');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.createdAt !== 'string'
      || !Number.isFinite(Date.parse(candidate.createdAt))
      || typeof candidate.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.id)) {
      throw new Error('invalid');
    }
    return { createdAt: new Date(candidate.createdAt).toISOString(), id: candidate.id };
  } catch {
    throw new BadRequestException('cursor is invalid.');
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
