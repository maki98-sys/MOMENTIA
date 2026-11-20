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

  async create(userId: string, input: unknown) {
    const v = this.validatePost(input);
    return this.db.transaction(async client => {
      if (v.mediaAssetId) {
        const media = await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`, [v.mediaAssetId,userId]);
        if (!media.rowCount) throw new NotFoundException('Media asset not found.');
      }
      if (v.spaceId) {
        const member = await client.query(`SELECT 1 FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[v.spaceId,userId]);
        if (!member.rowCount) throw new NotFoundException('Space not found.');
      }
      const result = await client.query(
        `INSERT INTO posts(author_id,body,media_asset_id,audience,space_id,status,published_at)
         VALUES($1,$2,$3,$4,$5,'published',now())
         RETURNING id,author_id,space_id,media_asset_id,body,audience,status,created_at,published_at`,
        [userId,v.body,v.mediaAssetId,v.audience,v.spaceId]);
      return result.rows[0];
    });
  }

  async feed(userId: string, cursor?: string, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit)||20,1),50);
    if (cursor !== undefined && (Number.isNaN(Date.parse(cursor)) || !Number.isFinite(Date.parse(cursor)))) {
      throw new BadRequestException('Feed cursor must be a valid ISO date-time.');
    }
    const result = await this.db.query(
      `SELECT p.id,p.author_id,p.space_id,p.media_asset_id,p.body,p.audience,p.published_at,
              up.display_name,up.avatar_media_id,
              (SELECT count(*)::int FROM content_reactions r WHERE r.target_type='post' AND r.target_id=p.id) reaction_count,
              (SELECT count(*)::int FROM post_comments c WHERE c.post_id=p.id AND c.status='visible') comment_count
       FROM posts p JOIN users u ON u.id=p.author_id AND u.status='active'
       LEFT JOIN user_profiles up ON up.user_id=p.author_id
       WHERE p.status='published' AND ($2::timestamptz IS NULL OR p.published_at<$2)
         AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
         AND (p.author_id=$1 OR p.audience='public'
           OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships ur
               WHERE ur.requester_id=$1 AND ur.target_id=p.author_id AND ur.state='accepted'))
           OR (p.audience='space' AND EXISTS(SELECT 1 FROM space_memberships sm
               WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'))
           OR p.audience='private' AND p.author_id=$1)
       ORDER BY p.published_at DESC,p.id DESC LIMIT $3`,
      [userId,cursor ?? null,safeLimit]);
    return result.rows;
  }

  async comments(userId: string, postId: string) {
    await this.assertCanView(userId,postId);
    const r=await this.db.query(`SELECT c.id,c.post_id,c.author_id,c.body,c.created_at,up.display_name
      FROM post_comments c LEFT JOIN user_profiles up ON up.user_id=c.author_id
      WHERE c.post_id=$1 AND c.status='visible' ORDER BY c.created_at ASC LIMIT 200`,[postId]);
    return r.rows;
  }

  async addComment(userId: string, postId: string, body: unknown) {
    if(typeof body!=='string'||!body.trim()||body.length>3000) throw new BadRequestException('Comment must contain 1 to 3000 characters.');
    await this.assertCanView(userId,postId);
    const r=await this.db.query(`INSERT INTO post_comments(post_id,author_id,body) VALUES($1,$2,$3)
      RETURNING id,post_id,author_id,body,created_at`,[postId,userId,body.trim()]);
    return r.rows[0];
  }

  async react(userId: string, postId: string, reaction: unknown) {
    if(!['like','love','laugh','wow','support'].includes(String(reaction))) throw new BadRequestException('Invalid reaction.');
    await this.assertCanView(userId,postId);
    const r=await this.db.query(`INSERT INTO content_reactions(target_type,target_id,user_id,reaction_type)
      VALUES('post',$1,$2,$3) ON CONFLICT(target_type,target_id,user_id)
      DO UPDATE SET reaction_type=EXCLUDED.reaction_type
      RETURNING id,target_id,reaction_type,created_at`,[postId,userId,reaction]);
    return r.rows[0];
  }

  async removeReaction(userId: string, postId: string) {
    // A known post UUID must not become a mutation capability: authorize visibility
    // before changing a reaction, even when the caller is removing their own row.
    await this.assertCanView(userId,postId);
    await this.db.query(`DELETE FROM content_reactions WHERE target_type='post' AND target_id=$1 AND user_id=$2`,[postId,userId]);
    return { removed:true };
  }

  private async assertCanView(userId: string, postId: string) {
    const r=await this.db.query(`SELECT 1 FROM posts p WHERE p.id=$2 AND p.status='published'
      AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
        (b.blocker_id=$1 AND b.blocked_id=p.author_id) OR (b.blocker_id=p.author_id AND b.blocked_id=$1))
      AND (p.author_id=$1 OR p.audience='public'
        OR (p.audience='followers' AND EXISTS(SELECT 1 FROM user_relationships ur
          WHERE ur.requester_id=$1 AND ur.target_id=p.author_id AND ur.state='accepted'))
        OR (p.audience='space' AND EXISTS(SELECT 1 FROM space_memberships sm
          WHERE sm.space_id=p.space_id AND sm.user_id=$1 AND sm.state='active'))`,[userId,postId]);
    if(!r.rowCount) throw new NotFoundException('Post not found.');
  }
}
