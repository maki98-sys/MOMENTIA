import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MediaService {
  constructor(private readonly db:DatabaseService) {}

  private validate(input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Upload data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['fileName','sizeBytes','checksumSha256','capturedAt','capturedTimezone','gpsConsent'].includes(k))) throw new BadRequestException('Unsupported upload fields.');
    if(typeof v.fileName!=='string'||!v.fileName.trim()||v.fileName.length>255||/[\\/\\0]/.test(v.fileName)) throw new BadRequestException('Invalid file name.');
    if(!Number.isSafeInteger(v.sizeBytes)||Number(v.sizeBytes)<1||Number(v.sizeBytes)>50*1024*1024) throw new BadRequestException('File size must be between 1 byte and 50 MB.');
    if(typeof v.checksumSha256!=='string'||! /^[a-f0-9]{64}$/i.test(v.checksumSha256)) throw new BadRequestException('A SHA-256 checksum is required.');
    if(v.capturedAt!==undefined&&(typeof v.capturedAt!=='string'||Number.isNaN(Date.parse(v.capturedAt)))) throw new BadRequestException('capturedAt must be a valid ISO date-time.');
    if(v.capturedTimezone!==undefined&&(typeof v.capturedTimezone!=='string'||v.capturedTimezone.length>64)) throw new BadRequestException('Invalid captured timezone.');
    if(v.gpsConsent!==undefined&&typeof v.gpsConsent!=='boolean') throw new BadRequestException('gpsConsent must be boolean.');
    return v;
  }

  async createUpload(userId:string,input:unknown,idempotencyKey:string) {
    const v=this.validate(input);
    if(!idempotencyKey||idempotencyKey.length>128) throw new BadRequestException('A valid Idempotency-Key header is required.');
    return this.db.transaction(async client=>{
      const prior=await client.query(
        `SELECT u.id upload_id,u.state,u.created_at,a.id media_asset_id,a.status
         FROM media_uploads u JOIN media_assets a ON a.id=u.media_asset_id
         WHERE u.uploader_id=$1 AND u.idempotency_key=$2`,[userId,idempotencyKey]);
      if(prior.rowCount) return prior.rows[0];
      const assetId=randomUUID();
      const storageKey='pending/'+userId+'/'+assetId;
      const asset=await client.query(
        `INSERT INTO media_assets(id,owner_id,storage_key_original,mime_type_detected,size_bytes,checksum_sha256,status)
         VALUES($1,$2,$3,'application/octet-stream',$4,$5,'pending')
         RETURNING id,status,size_bytes,created_at`,
        [assetId,userId,storageKey,v.sizeBytes,String(v.checksumSha256).toLowerCase()]);
      await client.query(
        `INSERT INTO media_metadata(media_asset_id,captured_at,captured_timezone,gps_consent_at)
         VALUES($1,$2,$3,CASE WHEN $4::boolean THEN now() ELSE NULL END)`,
        [assetId,v.capturedAt??null,v.capturedTimezone??null,v.gpsConsent===true]);
      const upload=await client.query(
        `INSERT INTO media_uploads(media_asset_id,uploader_id,state,idempotency_key)
         VALUES($1,$2,'created',$3)
         RETURNING id,state,created_at`,[assetId,userId,idempotencyKey]);
      return {...upload.rows[0],media_asset_id:asset.rows[0].id,asset_status:asset.rows[0].status,size_bytes:asset.rows[0].size_bytes};
    });
  }

  async getUpload(userId:string,uploadId:string) {
    const r=await this.db.query(
      `SELECT u.id,u.state,u.bytes_received,u.last_error_code,u.created_at,u.updated_at,
              a.id media_asset_id,a.status asset_status,a.size_bytes,a.mime_type_detected
       FROM media_uploads u JOIN media_assets a ON a.id=u.media_asset_id
       WHERE u.id=$1 AND u.uploader_id=$2`,[uploadId,userId]);
    if(!r.rowCount) throw new NotFoundException('Upload not found.');
    return r.rows[0];
  }

  async listMine(userId:string,limit=30) {
    const n=Math.min(Math.max(Number(limit)||30,1),100);
    const r=await this.db.query(
      `SELECT u.id,u.state,u.bytes_received,u.created_at,u.updated_at,
              a.id media_asset_id,a.status asset_status,a.size_bytes
       FROM media_uploads u JOIN media_assets a ON a.id=u.media_asset_id
       WHERE u.uploader_id=$1 ORDER BY u.created_at DESC LIMIT $2`,[userId,n]);
    return r.rows;
  }
}
