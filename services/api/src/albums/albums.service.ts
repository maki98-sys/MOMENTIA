import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AlbumsService {
  constructor(private readonly db:DatabaseService) {}

  private validate(input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Album data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['name','description','visibility','eventStartsAt','eventEndsAt'].includes(k))) throw new BadRequestException('Unsupported album fields.');
    const name=typeof v.name==='string'?v.name.trim():'';
    if(!name||name.length>120) throw new BadRequestException('Album name must contain 1 to 120 characters.');
    const description=v.description??null;
    if(description!==null&&(typeof description!=='string'||description.length>500)) throw new BadRequestException('Invalid album description.');
    const visibility=v.visibility??'members';
    if(!['members','admins'].includes(String(visibility))) throw new BadRequestException('Album visibility must be members or admins.');
    const start=v.eventStartsAt??null,end=v.eventEndsAt??null;
    for(const d of [start,end]) if(d!==null&&(typeof d!=='string'||Number.isNaN(Date.parse(d)))) throw new BadRequestException('Album event dates must be valid ISO date-times.');
    if(start&&end&&Date.parse(String(end))<Date.parse(String(start))) throw new BadRequestException('Event end cannot be earlier than its start.');
    return {name,description:description as string|null,visibility:String(visibility),start:start as string|null,end:end as string|null};
  }

  async create(userId:string,spaceId:string,input:unknown) {
    const v=this.validate(input);
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const member=await client.query(`SELECT sm.role FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id AND s.status='active' WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active'`,[spaceId,userId]);
      if(!member.rowCount||!['owner','admin','moderator'].includes(String(member.rows[0].role))) throw new NotFoundException('Space not found.');
      const result=await client.query(
        `INSERT INTO space_albums(space_id,created_by,name,description,visibility,event_starts_at,event_ends_at)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         RETURNING id,space_id,created_by,name,description,visibility,event_starts_at,event_ends_at,created_at`,
        [spaceId,userId,v.name,v.description,v.visibility,v.start,v.end]);
      await client.query(`INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
        VALUES($1,$2,'album.created','album',$3)`,[spaceId,userId,result.rows[0].id]);
      return result.rows[0];
    });
  }

  async list(userId:string,spaceId:string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      const r=await client.query(
        `SELECT a.id,a.space_id,a.created_by,a.name,a.description,a.visibility,a.event_starts_at,a.event_ends_at,a.created_at,
          (SELECT count(*)::int FROM space_album_items i
            JOIN users added_by ON added_by.id=i.added_by AND added_by.status='active'
            JOIN media_assets ma ON ma.id=i.media_asset_id AND ma.status='ready'
            JOIN users media_owner ON media_owner.id=ma.owner_id AND media_owner.status='active'
            WHERE i.album_id=a.id AND i.status='active'
              AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                (b.blocker_id=$1 AND b.blocked_id=i.added_by)
                OR (b.blocker_id=i.added_by AND b.blocked_id=$1))
              AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
                (b.blocker_id=$1 AND b.blocked_id=ma.owner_id)
                OR (b.blocker_id=ma.owner_id AND b.blocked_id=$1))) item_count
         FROM space_albums a JOIN spaces s ON s.id=a.space_id AND s.status IN ('active','archived')
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
         JOIN users viewer ON viewer.id=sm.user_id AND viewer.status='active'
         WHERE a.space_id=$2 AND (a.visibility='members' OR sm.role IN ('owner','admin','moderator'))
         ORDER BY a.created_at DESC`,[userId,spaceId]);
      if(!r.rowCount) {
        const membership=await client.query(
          `SELECT 1 FROM space_memberships sm JOIN spaces s ON s.id=sm.space_id AND s.status IN ('active','archived')
           WHERE sm.space_id=$1 AND sm.user_id=$2 AND sm.state='active'`,
          [spaceId,userId],
        );
        if(!membership.rowCount) throw new NotFoundException('Space not found.');
      }
      return r.rows;
    });
  }

  async listItems(userId:string,spaceId:string,albumId:string,cursor?:string,cursorId?:string,limit=30) {
    const pageSize=Math.min(Math.max(Number(limit)||30,1),100);
    if ((cursor && Number.isNaN(Date.parse(cursor))) || (!!cursor !== !!cursorId)) {
      throw new BadRequestException('Both a valid cursor timestamp and cursorId are required.');
    }
    if (cursorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursorId)) {
      throw new BadRequestException('cursorId must be a UUID.');
    }
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      const access=await client.query(
      `SELECT a.id,a.visibility,sm.role FROM space_albums a JOIN spaces s ON s.id=a.space_id AND s.status IN ('active','archived')
       JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
       JOIN users viewer ON viewer.id=sm.user_id AND viewer.status='active'
       WHERE a.id=$2 AND a.space_id=$3`,
      [userId,albumId,spaceId]);
    if(!access.rowCount) throw new NotFoundException('Album not found.');
    if(access.rows[0].visibility==='admins'&&!['owner','admin','moderator'].includes(String(access.rows[0].role))) {
      throw new NotFoundException('Album not found.');
    }
      const result=await client.query(
      `SELECT i.id,i.album_id,i.media_asset_id,i.added_by,i.caption,i.occurred_at,i.created_at,
              m.mime_type_detected,m.width,m.height,m.size_bytes
       FROM space_album_items i
       JOIN media_assets m ON m.id=i.media_asset_id AND m.status='ready'
       JOIN users added_by ON added_by.id=i.added_by AND added_by.status='active'
       JOIN users media_owner ON media_owner.id=m.owner_id AND media_owner.status='active'
       WHERE i.album_id=$1 AND i.status='active'
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$5 AND b.blocked_id=i.added_by)
           OR (b.blocker_id=i.added_by AND b.blocked_id=$5))
         AND NOT EXISTS(SELECT 1 FROM user_blocks b WHERE
           (b.blocker_id=$5 AND b.blocked_id=m.owner_id)
           OR (b.blocker_id=m.owner_id AND b.blocked_id=$5))
         AND ($2::timestamptz IS NULL OR (i.created_at,i.id)<($2::timestamptz,$3::uuid))
       ORDER BY i.created_at DESC,i.id DESC LIMIT $4`,
      [albumId,cursor??null,cursorId??null,pageSize+1,userId]);
    const hasMore=result.rows.length>pageSize;
    const items=result.rows.slice(0,pageSize);
    const last=items[items.length-1] as Record<string,unknown>|undefined;
      return {
        items,
        nextCursor:hasMore&&last?{createdAt:last.created_at,id:last.id}:null,
      };
    });
  }

  async addItem(userId:string,spaceId:string,albumId:string,input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Album item data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['mediaAssetId','caption','occurredAt'].includes(k))) throw new BadRequestException('Unsupported album item fields.');
    if(typeof v.mediaAssetId!=='string') throw new BadRequestException('mediaAssetId is required.');
    const caption=v.caption??null;
    if(caption!==null&&(typeof caption!=='string'||caption.length>500)) throw new BadRequestException('Caption must be at most 500 characters.');
    const occurred=v.occurredAt??new Date().toISOString();
    if(typeof occurred!=='string'||Number.isNaN(Date.parse(occurred))) throw new BadRequestException('occurredAt must be a valid ISO date-time.');
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const album=await client.query(
        `SELECT a.id,a.visibility,sm.role FROM space_albums a
         JOIN spaces s ON s.id=a.space_id AND s.status='active'
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
         JOIN users viewer ON viewer.id=sm.user_id AND viewer.status='active'
         WHERE a.id=$2 AND a.space_id=$3 FOR UPDATE`,[userId,albumId,spaceId]);
      if(!album.rowCount) throw new NotFoundException('Album not found.');
      if(album.rows[0].role==='guest') throw new NotFoundException('Album not found.');
      if(album.rows[0].visibility==='admins'&&!['owner','admin','moderator'].includes(String(album.rows[0].role))) throw new NotFoundException('Album not found.');
      const media=await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`,[v.mediaAssetId,userId]);
      if(!media.rowCount) throw new NotFoundException('Ready media asset not found.');
      const result=await client.query(
        `INSERT INTO space_album_items(album_id,media_asset_id,added_by,caption,occurred_at)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(album_id,media_asset_id) DO NOTHING
         RETURNING id,album_id,media_asset_id,added_by,caption,occurred_at,created_at`,
        [albumId,v.mediaAssetId,userId,caption,occurred]);
      if(!result.rowCount) throw new BadRequestException('This photo is already in the album.');
      await client.query(
        `INSERT INTO timeline_entries(space_id,media_asset_id,occurred_at,source)
         VALUES($1,$2,$3,'upload')`,[spaceId,v.mediaAssetId,occurred]);
      await client.query(`INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
        VALUES($1,$2,'album.item_added','album_item',$3)`,[spaceId,userId,result.rows[0].id]);
      return result.rows[0];
    });
  }

  async removeItem(userId:string,spaceId:string,albumId:string,itemId:string) {
    return this.db.transaction(async client=>{
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('momentia.sync.authorization', 0))");
      const result=await client.query(
        `SELECT i.id,i.added_by,sm.role FROM space_album_items i
         JOIN space_albums a ON a.id=i.album_id
         JOIN spaces s ON s.id=a.space_id AND s.status='active'
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
         JOIN users viewer ON viewer.id=sm.user_id AND viewer.status='active'
         WHERE i.id=$2 AND i.album_id=$3 AND a.space_id=$4 AND i.status='active' FOR UPDATE`,
        [userId,itemId,albumId,spaceId]);
      if(!result.rowCount) throw new NotFoundException('Album item not found.');
      const item=result.rows[0];
      if(item.added_by!==userId&&!['owner','admin','moderator'].includes(String(item.role))) throw new NotFoundException('Album item not found.');
      await client.query(`UPDATE space_album_items SET status='removed',removed_at=now() WHERE id=$1`,[itemId]);
      await client.query(`INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
        VALUES($1,$2,'album.item_removed','album_item',$3)`,[spaceId,userId,itemId]);
      return {removed:true};
    });
  }
}
