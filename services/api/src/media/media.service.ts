import { BadRequestException, Injectable, NotFoundException, ConflictException, ServiceUnavailableException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { mkdir, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { DatabaseService } from '../database/database.service';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

@Injectable()
export class MediaService {
  constructor(private readonly db:DatabaseService) {}


  private detectMime(bytes: Buffer): string | null {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
    if (bytes.length >= 12 && bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') return 'image/webp';
    if (bytes.length >= 12 && bytes.toString('ascii',4,8)==='ftyp') {
      const brand=bytes.toString('ascii',8,12);
      if (['heic','heix','hevc','hevx','mif1','msf1'].includes(brand)) return brand==='msf1' ? 'image/heif' : 'image/heic';
      if (brand==='qt  ') return 'video/quicktime';
      return 'video/mp4';
    }
    return null;
  }

  private validate(input:unknown) {
    if(!input||typeof input!=='object'||Array.isArray(input)) throw new BadRequestException('Upload data is required.');
    const v=input as Record<string,unknown>;
    if(Object.keys(v).some(k=>!['fileName','mimeType','sizeBytes','checksumSha256','capturedAt','capturedTimezone','gpsConsent'].includes(k))) throw new BadRequestException('Unsupported upload fields.');
    if(typeof v.fileName!=='string'||!v.fileName.trim()||v.fileName.length>255||/[\\/\\0]/.test(v.fileName)) throw new BadRequestException('Invalid file name.');
    if(!['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime'].includes(String(v.mimeType))) throw new BadRequestException('Unsupported declared media type.');
    if(!Number.isSafeInteger(v.sizeBytes)||Number(v.sizeBytes)<1||Number(v.sizeBytes)>MAX_UPLOAD_BYTES) throw new BadRequestException('File size must be between 1 byte and 200 MB.');
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
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':'+idempotencyKey]);
      const prior=await client.query(
        `SELECT u.id upload_id,u.state,u.created_at,a.id media_asset_id,a.status
         FROM media_uploads u JOIN media_assets a ON a.id=u.media_asset_id
         WHERE u.uploader_id=$1 AND u.idempotency_key=$2`,[userId,idempotencyKey]);
      if(prior.rowCount) return prior.rows[0];
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[userId+':storage-quota']);
      const entitlement=await client.query(
        `SELECT p.storage_quota_bytes,p.max_upload_bytes,
                COALESCE(usage.used_bytes,0)::bigint used_bytes
         FROM subscription_plans p
         LEFT JOIN LATERAL (
           SELECT us.plan_id FROM user_subscriptions us
           WHERE us.user_id=$1 AND us.status IN ('trialing','active','past_due')
             AND (us.current_period_end IS NULL OR us.current_period_end>now())
           ORDER BY CASE us.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
                    us.created_at DESC LIMIT 1
         ) s ON s.plan_id=p.id
         LEFT JOIN LATERAL (
           SELECT (
             COALESCE((SELECT sum(a.size_bytes) FROM media_assets a
                       WHERE a.owner_id=$1 AND a.status<>'deleted'),0)
             + COALESCE((SELECT sum(v.size_bytes)
                         FROM media_variants v JOIN media_assets a ON a.id=v.media_asset_id
                         WHERE a.owner_id=$1 AND a.status<>'deleted'),0)
           )::bigint used_bytes
         ) usage ON true
         WHERE p.id=COALESCE(s.plan_id,(SELECT id FROM subscription_plans WHERE code='free'))`,
        [userId],
      );
      if(!entitlement.rowCount) throw new ServiceUnavailableException('Storage plans are not configured.');
      const limits=entitlement.rows[0];
      if(Number(v.sizeBytes)>Number(limits.max_upload_bytes)) throw new PayloadTooLargeException('This file exceeds the maximum upload size for your plan.');
      if(BigInt(limits.used_bytes)+BigInt(Number(v.sizeBytes))>BigInt(limits.storage_quota_bytes)) {
        throw new PayloadTooLargeException('Your storage quota has been reached. Upgrade your plan or delete existing media.');
      }
      const assetId=randomUUID();
      const storageKey='pending/'+userId+'/'+assetId;
      const asset=await client.query(
        `INSERT INTO media_assets(id,owner_id,storage_key_original,original_filename,mime_type_detected,size_bytes,checksum_sha256,status)
         VALUES($1,$2,$3,$4,'application/octet-stream',$5,$6,'pending')
         RETURNING id,status,size_bytes,created_at`,
        [assetId,userId,storageKey,v.fileName,v.sizeBytes,String(v.checksumSha256).toLowerCase()]);
      await client.query(
        `INSERT INTO media_metadata(media_asset_id,captured_at,captured_timezone,gps_consent_at)
         VALUES($1,$2,$3,CASE WHEN $4::boolean THEN now() ELSE NULL END)`,
        [assetId,v.capturedAt??null,v.capturedTimezone??null,v.gpsConsent===true]);
      const upload=await client.query(
        `INSERT INTO media_uploads(media_asset_id,uploader_id,state,idempotency_key,declared_mime_type)
         VALUES($1,$2,'created',$3,$4)
         RETURNING id,state,created_at`,[assetId,userId,idempotencyKey,v.mimeType]);
      return {...upload.rows[0],media_asset_id:asset.rows[0].id,asset_status:asset.rows[0].status,size_bytes:asset.rows[0].size_bytes};
    });
  }

  async receiveUpload(userId:string,uploadId:string,bytes:Buffer) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) throw new BadRequestException('Invalid upload id.');
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_UPLOAD_BYTES) throw new BadRequestException('Invalid upload body size.');
    const found=await this.db.query(
      `SELECT u.id,u.state,u.bytes_received,u.uploader_id,a.id media_asset_id,a.size_bytes,a.checksum_sha256,a.storage_key_original,u.declared_mime_type
       FROM media_uploads u JOIN media_assets a ON a.id=u.media_asset_id WHERE u.id=$1 AND u.uploader_id=$2`,
      [uploadId,userId]);
    if (!found.rowCount) throw new NotFoundException('Upload not found.');
    const row=found.rows[0];
    if (row.state === 'uploaded' || row.state === 'processing' || row.state === 'completed') return this.getUpload(userId,uploadId);
    if (row.state !== 'created' && row.state !== 'uploading') throw new ConflictException('Upload is not accepting content.');
    if (Number(row.size_bytes) !== bytes.length) throw new BadRequestException('Uploaded byte count does not match the declared size.');
    const checksum=createHash('sha256').update(bytes).digest('hex');
    if (checksum !== String(row.checksum_sha256).trim().toLowerCase()) throw new BadRequestException('SHA-256 checksum mismatch.');
    const detectedMime = this.detectMime(bytes);
    if (!detectedMime || detectedMime !== row.declared_mime_type) {
      throw new BadRequestException('File content does not match the declared media type.');
    }
    const base=resolve(process.env.MEDIA_STORAGE_DIR || '/var/lib/momentia/media');
    const relative=String(row.storage_key_original);
    if (!relative.startsWith('pending/') || relative.includes('..')) throw new ServiceUnavailableException('Invalid storage key.');
    const destination=resolve(join(base,relative));
    if (!destination.startsWith(base + '/')) throw new ServiceUnavailableException('Invalid storage destination.');
    const temporary=destination+'.'+randomUUID()+'.tmp';
    try {
      await mkdir(dirname(destination),{recursive:true});
      await writeFile(temporary,bytes,{flag:'wx',mode:0o600});
      await rename(temporary,destination);
    } catch (error) {
      await rm(temporary,{force:true}).catch(()=>undefined);
      throw new ServiceUnavailableException('Media storage is unavailable.');
    }
    try {
      await this.db.transaction(async client=>{
        const updated=await client.query(
          `UPDATE media_uploads SET state='uploaded',bytes_received=$1,updated_at=now()
           WHERE id=$2 AND uploader_id=$3 AND state IN ('created','uploading')`,
          [bytes.length,uploadId,userId]);
        if (!updated.rowCount) throw new ConflictException('Upload state changed while receiving content.');
        await client.query(
          `UPDATE media_assets SET status='quarantined',mime_type_detected=$1 WHERE id=$2 AND owner_id=$3`,
          [row.declared_mime_type,row.media_asset_id,userId]);
        await client.query(
          `INSERT INTO storage_usage_events(user_id,media_asset_id,event_type,bytes_delta,idempotency_key)
           VALUES($1,$2,'uploaded',$3,$4) ON CONFLICT(idempotency_key) DO NOTHING`,
          [userId,row.media_asset_id,bytes.length,'media-upload:'+uploadId]);
        await client.query(
          `INSERT INTO media_processing_jobs(media_asset_id,job_type)
           VALUES($1,'inspect'),($1,'virus_scan')
           ON CONFLICT(media_asset_id,job_type) DO NOTHING`,
          [row.media_asset_id]);
      });
    } catch (error) {
      await rm(destination,{force:true}).catch(()=>undefined);
      throw error;
    }
    return this.getUpload(userId,uploadId);
  }

  async cancelUpload(userId:string,uploadId:string) {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
      throw new BadRequestException('Invalid upload id.');
    }
    return this.db.transaction(async client=>{
      const result=await client.query(
        `SELECT u.id,u.state,u.media_asset_id,a.status asset_status
         FROM media_uploads u
         JOIN media_assets a ON a.id=u.media_asset_id
         WHERE u.id=$1 AND u.uploader_id=$2
         FOR UPDATE OF u,a`,
        [uploadId,userId],
      );
      if(!result.rowCount) throw new NotFoundException('Upload not found.');
      const upload=result.rows[0];
      if(upload.state==='cancelled') return {cancelled:true,alreadyCancelled:true};
      if(!['created','uploading'].includes(String(upload.state))) {
        throw new ConflictException('Only an upload that has not been received can be cancelled.');
      }
      await client.query(
        `UPDATE media_uploads SET state='cancelled',updated_at=now()
         WHERE id=$1 AND uploader_id=$2`,
        [uploadId,userId],
      );
      await client.query(
        `UPDATE media_assets SET status='deleted',deleted_at=now()
         WHERE id=$1 AND owner_id=$2 AND status='pending'`,
        [upload.media_asset_id,userId],
      );
      return {cancelled:true,alreadyCancelled:false};
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


  private async findViewableAsset(userId:string,assetId:string) {
    const result=await this.db.query(
      `SELECT a.id,a.status,a.owner_id,a.storage_key_original,a.mime_type_detected,
              a.original_filename,a.size_bytes,a.width,a.height,a.created_at,
              a.processing_completed_at,a.moderation_scan_status
       FROM media_assets a
       WHERE a.id=$1 AND a.status='ready'
         AND (
           a.owner_id=$2
           OR (
             NOT EXISTS (SELECT 1 FROM user_blocks b
               WHERE (b.blocker_id=$2 AND b.blocked_id=a.owner_id)
                  OR (b.blocker_id=a.owner_id AND b.blocked_id=$2))
             AND (
               EXISTS (
                 SELECT 1 FROM posts p
                 WHERE p.media_asset_id=a.id AND p.status='published'
                   AND NOT EXISTS (SELECT 1 FROM user_blocks b
                     WHERE (b.blocker_id=$2 AND b.blocked_id=p.author_id)
                        OR (b.blocker_id=p.author_id AND b.blocked_id=$2))
                   AND (p.author_id=$2 OR p.audience='public'
                     OR (p.audience='followers' AND EXISTS (
                       SELECT 1 FROM user_relationships ur
                       WHERE ur.requester_id=$2 AND ur.target_id=p.author_id AND ur.state='accepted'))
                     OR (p.audience='space' AND EXISTS (
                       SELECT 1 FROM space_memberships sm
                       WHERE sm.space_id=p.space_id AND sm.user_id=$2 AND sm.state='active')))
               )
               OR EXISTS (
                 SELECT 1 FROM space_album_items i
                 JOIN space_albums al ON al.id=i.album_id
                 JOIN space_memberships sm ON sm.space_id=al.space_id AND sm.user_id=$2 AND sm.state='active'
                 WHERE i.media_asset_id=a.id AND i.status='active'
                   AND (al.visibility='members' OR sm.role IN ('owner','admin','moderator'))
               )
               OR EXISTS (
                 SELECT 1 FROM timeline_entries te
                 JOIN space_memberships sm ON sm.space_id=te.space_id AND sm.user_id=$2 AND sm.state='active'
                 WHERE te.media_asset_id=a.id
               )
             )
           )
         )
       LIMIT 1`,[assetId,userId]);
    if(!result.rowCount) throw new NotFoundException('Media asset not found.');
    return result.rows[0] as Record<string,unknown>;
  }

  async getAssetContent(userId:string,assetId:string,variantType?:string) {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) throw new BadRequestException('Invalid media asset id.');
    if(variantType!==undefined&&!['original','thumbnail','preview','display','video_poster'].includes(variantType)) throw new BadRequestException('Unsupported media variant.');
    const asset=await this.findViewableAsset(userId,assetId);
    let storageKey=String(asset.storage_key_original);
    let mimeType=String(asset.mime_type_detected);
    let filename=String(asset.original_filename??'media');
    let sizeBytes=Number(asset.size_bytes);
    if(variantType&&variantType!=='original') {
      const variant=await this.db.query(
        `SELECT storage_key,mime_type,size_bytes FROM media_variants
         WHERE media_asset_id=$1 AND variant_type=$2`,[assetId,variantType]);
      if(!variant.rowCount) throw new NotFoundException('Media variant not found.');
      storageKey=String(variant.rows[0].storage_key);
      mimeType=String(variant.rows[0].mime_type);
      sizeBytes=Number(variant.rows[0].size_bytes);
      filename=variantType+'.'+(mimeType==='image/webp'?'webp':'jpg');
    }
    const base=resolve(process.env.MEDIA_STORAGE_DIR||'/var/lib/momentia/media');
    const target=resolve(join(base,storageKey));
    if(!target.startsWith(base+'/')) throw new ServiceUnavailableException('Invalid media storage path.');
    const info=await stat(target).catch(()=>null);
    if(!info||!info.isFile()||info.size!==sizeBytes) throw new ServiceUnavailableException('Media content is unavailable.');
    return {path:target,mimeType,filename,sizeBytes};
  }

  async getAsset(userId:string,assetId:string) {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) throw new BadRequestException('Invalid media asset id.');
    const asset=await this.findViewableAsset(userId,assetId);
    const variants=await this.db.query(
      `SELECT variant_type,mime_type,size_bytes,width,height,created_at
       FROM media_variants WHERE media_asset_id=$1 ORDER BY variant_type`,[assetId]);
    return {...asset,variants:variants.rows};
  }

  async deleteAsset(userId:string,assetId:string) {
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assetId)) throw new BadRequestException('Invalid media asset id.');
    return this.db.transaction(async client=>{
      const asset=await client.query(
        `SELECT id,status,size_bytes,storage_key_original FROM media_assets
         WHERE id=$1 AND owner_id=$2 FOR UPDATE`,[assetId,userId]);
      if(!asset.rowCount) throw new NotFoundException('Media asset not found.');
      if(asset.rows[0].status==='deleted') return {deleted:true,alreadyDeleted:true};
      const variants=await client.query(
        `SELECT storage_key FROM media_variants WHERE media_asset_id=$1 FOR UPDATE`,[assetId]);
      const deletionValues=[`($1,$2)`,...variants.rows.map((_,i)=>`($1,${i+3})`)].join(',');
      await client.query(
        `INSERT INTO media_storage_deletions(media_asset_id,storage_key)
         VALUES ${deletionValues}
         ON CONFLICT(media_asset_id,storage_key) DO NOTHING`,
        [assetId,asset.rows[0].storage_key_original,...variants.rows.map(v=>v.storage_key)]);
      await client.query(
        `UPDATE media_processing_jobs SET status='cancelled',locked_at=NULL,locked_by=NULL,updated_at=now()
         WHERE media_asset_id=$1 AND status IN ('pending','processing','failed')`,[assetId]);
      await client.query(
        `UPDATE posts SET status='removed',updated_at=now()
         WHERE media_asset_id=$1 AND author_id=$2 AND status<>'removed'`,[assetId,userId]);
      await client.query(
        `UPDATE space_album_items SET status='removed',removed_at=now()
         WHERE media_asset_id=$1 AND status='active'`,[assetId]);
      await client.query(
        `DELETE FROM timeline_entries WHERE media_asset_id=$1
          OR post_id IN (SELECT id FROM posts WHERE media_asset_id=$1)`,[assetId]);
      await client.query(
        `UPDATE user_profiles SET avatar_media_id=NULL,updated_at=now()
         WHERE user_id=$1 AND avatar_media_id=$2`,[userId,assetId]);
      await client.query(
        `UPDATE media_assets SET status='deleted',deleted_at=now() WHERE id=$1`,[assetId]);
      await client.query(
        `UPDATE media_uploads SET state='cancelled',updated_at=now()
         WHERE media_asset_id=$1 AND state NOT IN ('completed','failed','cancelled')`,[assetId]);
      await client.query(
        `INSERT INTO storage_usage_events(user_id,media_asset_id,event_type,bytes_delta,idempotency_key)
         VALUES($1,$2,'deleted',$3,$4) ON CONFLICT(idempotency_key) DO NOTHING`,
        [userId,assetId,-Number(asset.rows[0].size_bytes),'media-delete:'+assetId]);
      return {deleted:true,queuedStorageObjects:variants.rowCount+1};
    });
  }

}
