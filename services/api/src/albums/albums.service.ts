import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
      const member=await client.query(`SELECT role FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[spaceId,userId]);
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
    const r=await this.db.query(
      `SELECT a.id,a.space_id,a.created_by,a.name,a.description,a.visibility,a.event_starts_at,a.event_ends_at,a.created_at,
        (SELECT count(*)::int FROM space_album_items i WHERE i.album_id=a.id AND i.status='active') item_count
       FROM space_albums a JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
       WHERE a.space_id=$2 AND (a.visibility='members' OR sm.role IN ('owner','admin','moderator'))
       ORDER BY a.created_at DESC`,[userId,spaceId]);
    if(!r.rowCount) {
      const membership=await this.db.query(`SELECT 1 FROM space_memberships WHERE space_id=$1 AND user_id=$2 AND state='active'`,[spaceId,userId]);
      if(!membership.rowCount) throw new NotFoundException('Space not found.');
    }
    return r.rows;
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
      const album=await client.query(
        `SELECT a.id,a.visibility,sm.role FROM space_albums a
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
         WHERE a.id=$2 AND a.space_id=$3 FOR UPDATE`,[userId,albumId,spaceId]);
      if(!album.rowCount) throw new NotFoundException('Album not found.');
      if(album.rows[0].visibility==='admins'&&!['owner','admin','moderator'].includes(String(album.rows[0].role))) throw new NotFoundException('Album not found.');
      const media=await client.query(`SELECT id FROM media_assets WHERE id=$1 AND owner_id=$2 AND status='ready'`,[v.mediaAssetId,userId]);
      if(!media.rowCount) throw new NotFoundException('Ready media asset not found.');
      const result=await client.query(
        `INSERT INTO space_album_items(album_id,media_asset_id,added_by,caption,occurred_at)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(album_id,media_asset_id) DO NOTHING
         RETURNING id,album_id,media_asset_id,added_by,caption,occurred_at,created_at`,
        [albumId,v.mediaAssetId,userId,caption,occurred]);
      if(!result.rowCount) throw new BadRequestException('This photo is already in the album.');
      await client.query(`INSERT INTO space_audit_events(space_id,actor_id,action,resource_type,resource_id)
        VALUES($1,$2,'album.item_added','album_item',$3)`,[spaceId,userId,result.rows[0].id]);
      return result.rows[0];
    });
  }

  async removeItem(userId:string,spaceId:string,albumId:string,itemId:string) {
    return this.db.transaction(async client=>{
      const result=await client.query(
        `SELECT i.id,i.added_by,sm.role FROM space_album_items i
         JOIN space_albums a ON a.id=i.album_id
         JOIN space_memberships sm ON sm.space_id=a.space_id AND sm.user_id=$1 AND sm.state='active'
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
