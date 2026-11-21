import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class TimelineService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId:string,spaceId:string,cursor?:string,limit=30,cursorId?:string) {
    const n=Math.min(Math.max(Number(limit)||30,1),100);
    if ((cursor && Number.isNaN(Date.parse(cursor))) || (!!cursor !== !!cursorId)) {
      throw new BadRequestException('Both a valid cursor timestamp and cursorId are required.');
    }
    if (cursorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursorId)) {
      throw new BadRequestException('cursorId must be a UUID.');
    }
    const r=await this.db.query(
      `SELECT t.id,t.space_id,t.post_id,t.media_asset_id,t.occurred_at,t.source,t.created_at,
              p.author_id,p.body,p.audience,
              m.mime_type_detected,m.width,m.height,m.size_bytes,
              COALESCE(up.display_name,pu.display_name) display_name
       FROM timeline_entries t
       JOIN space_memberships sm ON sm.space_id=t.space_id AND sm.user_id=$1 AND sm.state='active'
       LEFT JOIN posts p ON p.id=t.post_id AND p.status='published'
       LEFT JOIN user_profiles up ON up.user_id=p.author_id
       LEFT JOIN media_assets m ON m.id=t.media_asset_id AND m.status='ready'
       LEFT JOIN user_profiles pu ON pu.user_id=m.owner_id
       WHERE t.space_id=$2 AND ($3::timestamptz IS NULL OR (t.occurred_at,t.id)<($3::timestamptz,$4::uuid))
       ORDER BY t.occurred_at DESC,t.id DESC LIMIT $5`,
      [userId,spaceId,cursor??null,cursorId??null,n]);
    if(!r.rowCount) {
      const member=await this.db.query(`SELECT 1 FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[spaceId,userId]);
      if(!member.rowCount) throw new NotFoundException('Space not found.');
    }
    return r.rows;
  }

  async add(userId:string,spaceId:string,input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Timeline entry data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['postId','mediaAssetId','occurredAt','source'].includes(k))) throw new BadRequestException('Unsupported timeline fields.');
    const hasPost=typeof v.postId==='string';
    const hasMedia=typeof v.mediaAssetId==='string';
    if(hasPost===hasMedia) throw new BadRequestException('Provide exactly one postId or mediaAssetId.');
    const source=v.source??(hasPost?'post':'upload');
    if(!['capture','post','upload','import'].includes(String(source))) throw new BadRequestException('Invalid timeline source.');
    const occurredAt=v.occurredAt??new Date().toISOString();
    if(typeof occurredAt!=='string'||Number.isNaN(Date.parse(occurredAt))) throw new BadRequestException('occurredAt must be a valid ISO date-time.');
    return this.db.transaction(async client=>{
      const member=await client.query(`SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[spaceId,userId]);
      if(!member.rowCount) throw new NotFoundException('Space not found.');
      if(member.rows[0].role==='guest') throw new NotFoundException('Space not found.');
      if(hasPost) {
        const post=await client.query(`SELECT id FROM posts WHERE id=$1 AND space_id=$2 AND status='published'`,[v.postId,spaceId]);
        if(!post.rowCount) throw new NotFoundException('Published post in this space not found.');
      } else {
        const media=await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`,[v.mediaAssetId,userId]);
        if(!media.rowCount) throw new NotFoundException('Ready media asset not found.');
      }
      const result=await client.query(
        `INSERT INTO timeline_entries(space_id,post_id,media_asset_id,occurred_at,source)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,space_id,post_id,media_asset_id,occurred_at,source,created_at`,
        [spaceId,hasPost?v.postId:null,hasMedia?v.mediaAssetId:null,occurredAt,source]);
      await client.query(
        `INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
         VALUES($1,$2,'timeline.entry_added','timeline_entry',$3)`,
        [spaceId,userId,result.rows[0].id]);
      return result.rows[0];
    });
  }
}
