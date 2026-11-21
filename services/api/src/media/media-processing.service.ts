import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class MediaProcessingService {
  constructor(private readonly db: DatabaseService) {}

  async claim(workerId: string, limit = 10) {
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    const batch = Math.min(Math.max(Number(limit) || 10, 1), 50);
    return this.db.transaction(async client => {
      const jobs = await client.query(
        `WITH picked AS (
           SELECT id FROM media_processing_jobs
           WHERE status IN ('pending','failed') AND available_at<=now()
             AND attempts<max_attempts
           ORDER BY available_at,created_at
           LIMIT $1 FOR UPDATE SKIP LOCKED
         )
         UPDATE media_processing_jobs j
         SET status='processing',attempts=j.attempts+1,locked_at=now(),locked_by=$2,updated_at=now()
         FROM picked p WHERE j.id=p.id
         RETURNING j.id,j.media_asset_id,j.job_type,j.attempts,j.max_attempts`,
        [batch,workerId],
      );
      if (!jobs.rowCount) return [];
      const ids = jobs.rows.map(job => job.id);
      const details = await client.query(
        `SELECT j.id,j.media_asset_id,j.job_type,j.attempts,j.max_attempts,
                a.storage_key_original,a.storage_provider,a.mime_type_detected,a.size_bytes,a.checksum_sha256
         FROM media_processing_jobs j
         JOIN media_assets a ON a.id=j.media_asset_id
         WHERE j.id=ANY($1::uuid[]) ORDER BY j.created_at,j.id`,[ids],
      );
      return details.rows;
    });
  }

  async complete(workerId: string, jobId: string, input: unknown) {
    if (!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      throw new BadRequestException('Invalid job id.');
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Job result is required.');
    const value=input as Record<string,unknown>;
    if (Object.keys(value).some(key=>!['success','errorCode','result','scanVerdict','variants'].includes(key)) ||
        typeof value.success!=='boolean') throw new BadRequestException('Invalid job result.');
    if (value.errorCode!==undefined && (typeof value.errorCode!=='string'||value.errorCode.length>120)) throw new BadRequestException('Invalid error code.');
    if (value.result!==undefined && (!value.result || typeof value.result!=='object' || Array.isArray(value.result) || Buffer.byteLength(JSON.stringify(value.result))>12000)) throw new BadRequestException('Invalid result metadata.');
    if (value.scanVerdict!==undefined && !['clean','rejected','unavailable'].includes(String(value.scanVerdict))) throw new BadRequestException('Invalid scan verdict.');
    return this.db.transaction(async client=>{
      const locked=await client.query(
        `SELECT j.id,j.media_asset_id,j.job_type,j.attempts,j.max_attempts,a.mime_type_detected,a.storage_provider,a.status asset_status
         FROM media_processing_jobs j JOIN media_assets a ON a.id=j.media_asset_id
         WHERE j.id=$1 AND j.status='processing' AND j.locked_by=$2
         FOR UPDATE OF j,a`,[jobId,workerId]);
      if(!locked.rowCount) throw new NotFoundException('Processing job not found or not owned by this worker.');
      const job=locked.rows[0];
      if(job.asset_status==='deleted'||job.asset_status==='failed') {
        await client.query(`UPDATE media_processing_jobs SET status='cancelled',locked_at=NULL,locked_by=NULL,updated_at=now() WHERE id=$1`,[jobId]);
        return {jobId,status:'cancelled',reason:job.asset_status==='deleted'?'MEDIA_DELETED':'MEDIA_FAILED'};
      }
      if(!value.success) {
        const terminal=Number(job.attempts)>=Number(job.max_attempts);
        await client.query(
          `UPDATE media_processing_jobs SET status=$2,last_error_code=$3,
             available_at=now()+make_interval(secs=>LEAST(1800,15*(2^LEAST(attempts,7))::integer)),
             locked_at=NULL,locked_by=NULL,updated_at=now()
           WHERE id=$1`,
          [jobId,terminal?'failed':'failed',value.errorCode??'PROCESSING_FAILED']);
        if(terminal) await client.query(
          `UPDATE media_assets SET status='failed' WHERE id=$1 AND status IN ('pending','processing','quarantined')`,
          [job.media_asset_id]);
        return {jobId,status:'failed',retryable:!terminal};
      }
      if(job.job_type==='virus_scan') {
        const verdict=String(value.scanVerdict??'unavailable');
        await client.query(
          `UPDATE media_assets SET moderation_scan_status=$2,
             status=CASE WHEN $2='rejected' THEN 'quarantined' ELSE status END
           WHERE id=$1`,[job.media_asset_id,verdict]);
        if(verdict==='clean') {
          await client.query(
            `INSERT INTO media_processing_jobs(media_asset_id,job_type)
             VALUES($1,$2)
             ON CONFLICT(media_asset_id,job_type) DO NOTHING`,
            [job.media_asset_id,job.mime_type_detected.startsWith('video/')?'video_poster':'image_variants']);
        }
      } else if(job.job_type==='image_variants'||job.job_type==='video_poster') {
        if(!Array.isArray(value.variants)||value.variants.length<1||value.variants.length>8) {
          throw new BadRequestException('A successful variant job must return between 1 and 8 variants.');
        }
        for(const item of value.variants) {
          if(!item||typeof item!=='object'||Array.isArray(item)) throw new BadRequestException('Invalid media variant.');
          const v=item as Record<string,unknown>;
          if(!['thumbnail','preview','display','video_poster'].includes(String(v.variantType)) ||
             typeof v.storageKey!=='string'||!v.storageKey.startsWith('variants/')||v.storageKey.includes('..')||v.storageKey.length>500||
             typeof v.mimeType!=='string'||!['image/jpeg','image/png','image/webp'].includes(v.mimeType)||
             !Number.isSafeInteger(v.sizeBytes)||Number(v.sizeBytes)<1||!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||
             Number(v.width)<1||Number(v.height)<1||typeof v.checksumSha256!=='string'||! /^[a-f0-9]{64}$/i.test(v.checksumSha256)) {
            throw new BadRequestException('Invalid generated media variant metadata.');
          }
          await client.query(
            `INSERT INTO media_variants(media_asset_id,variant_type,storage_key,mime_type,size_bytes,width,height,checksum_sha256,storage_provider)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT(media_asset_id,variant_type) DO UPDATE SET
               storage_key=EXCLUDED.storage_key,mime_type=EXCLUDED.mime_type,size_bytes=EXCLUDED.size_bytes,
               width=EXCLUDED.width,height=EXCLUDED.height,checksum_sha256=EXCLUDED.checksum_sha256,
               storage_provider=EXCLUDED.storage_provider`,
            [job.media_asset_id,v.variantType,v.storageKey,v.mimeType,v.sizeBytes,v.width,v.height,String(v.checksumSha256).toLowerCase(),String(job.storage_provider??'local')]);
        }
        await client.query(
          `INSERT INTO media_processing_jobs(media_asset_id,job_type)
           VALUES($1,'finalize') ON CONFLICT(media_asset_id,job_type) DO NOTHING`,
          [job.media_asset_id]);
      } else if(job.job_type==='finalize') {
        const ready=await client.query(
          `SELECT status,moderation_scan_status FROM media_assets WHERE id=$1 FOR UPDATE`,[job.media_asset_id]);
        if(ready.rows[0].moderation_scan_status!=='clean') throw new BadRequestException('Media cannot be published before a clean moderation scan.');
        const variantCount=await client.query(
          `SELECT count(*)::int total FROM media_variants WHERE media_asset_id=$1`,[job.media_asset_id]);
        if(!Number(variantCount.rows[0].total)) throw new BadRequestException('Media cannot be finalized without generated variants.');
        await client.query(
          `UPDATE media_assets SET status='ready',processing_completed_at=now() WHERE id=$1`,
          [job.media_asset_id]);
        await client.query(
          `UPDATE media_uploads SET state='completed',updated_at=now()
           WHERE media_asset_id=$1 AND state IN ('uploaded','processing')`,[job.media_asset_id]);
      }
      await client.query(
        `UPDATE media_processing_jobs SET status='completed',result=$2::jsonb,
           locked_at=NULL,locked_by=NULL,last_error_code=NULL,updated_at=now() WHERE id=$1`,
        [jobId,JSON.stringify(value.result??{})]);
      return {jobId,status:'completed',mediaAssetId:job.media_asset_id,nextStage:job.job_type==='virus_scan'?'variants':job.job_type==='finalize'?'ready':'continue'};
    });
  }


  async cleanupExpiredUploads(limit = 100) {
    const batch = Math.min(Math.max(Number(limit) || 100, 1), 500);
    return this.db.transaction(async client => {
      const expired = await client.query(
        `WITH candidates AS (
           SELECT u.id,u.media_asset_id,a.storage_key_original,a.storage_provider
           FROM media_uploads u
           JOIN media_assets a ON a.id=u.media_asset_id
           WHERE u.state IN ('created','uploading','assembling') AND u.expires_at<=now()
             AND a.status IN ('pending','quarantined')
           ORDER BY u.expires_at,u.created_at
           LIMIT $1 FOR UPDATE OF u,a SKIP LOCKED
         ),
         cancelled AS (
           UPDATE media_uploads u SET state='cancelled',
             last_error_code='UPLOAD_EXPIRED',updated_at=now()
           FROM candidates c WHERE u.id=c.id
           RETURNING u.id,u.media_asset_id
         ),
         deleted AS (
           UPDATE media_assets a SET status='deleted',deleted_at=now()
           FROM cancelled c WHERE a.id=c.media_asset_id
           RETURNING a.id,a.storage_key_original,a.storage_provider
         )
         INSERT INTO media_storage_deletions(media_asset_id,storage_key,storage_provider)
         SELECT d.id,d.storage_key_original,d.storage_provider FROM deleted d
         ON CONFLICT(media_asset_id,storage_key) DO NOTHING
         RETURNING id,media_asset_id,storage_key`,
        [batch],
      );
      const uploadIds=expired.rows.map(row=>row.id);
      let removedParts=0;
      if(uploadIds.length) {
        const parts=await client.query(
          `SELECT p.upload_id,p.storage_key,p.storage_provider,u.media_asset_id
           FROM media_upload_parts p JOIN media_uploads u ON u.id=p.upload_id
           WHERE p.upload_id=ANY($1::uuid[])`,[uploadIds]);
        if(parts.rowCount) {
          await client.query(
            `INSERT INTO media_storage_deletions(media_asset_id,storage_key,storage_provider)
             SELECT x.media_asset_id,x.storage_key,x.storage_provider FROM jsonb_to_recordset($1::jsonb)
             AS x(media_asset_id uuid,storage_key text,storage_provider text)
             ON CONFLICT(media_asset_id,storage_key) DO NOTHING`,
            [JSON.stringify(parts.rows)]);
          await client.query(`DELETE FROM media_upload_parts WHERE upload_id=ANY($1::uuid[])`,[uploadIds]);
          removedParts=parts.rowCount;
        }
      }
      return { expired: expired.rowCount ?? 0, storageDeletions: expired.rows, removedParts };
    });
  }

  async releaseStaleLocks(staleSeconds=300) {
    const seconds=Math.min(Math.max(Number(staleSeconds)||300,60),3600);
    const result=await this.db.query(
      `UPDATE media_processing_jobs SET status='failed',locked_at=NULL,locked_by=NULL,
         last_error_code='WORKER_LEASE_EXPIRED',available_at=now(),updated_at=now()
       WHERE status='processing' AND locked_at<now()-make_interval(secs=>$1)
       RETURNING id,media_asset_id,attempts,max_attempts`,[seconds]);
    const terminalAssets=result.rows.filter(job=>Number(job.attempts)>=Number(job.max_attempts)).map(job=>job.media_asset_id);
    if(terminalAssets.length) await this.db.query(
      `UPDATE media_assets SET status='failed'
       WHERE id=ANY($1::uuid[]) AND status IN ('pending','processing','quarantined')`,[terminalAssets]);
    const deletions=await this.db.query(
      `UPDATE media_storage_deletions SET status='failed',locked_at=NULL,locked_by=NULL,
         last_error_code='WORKER_LEASE_EXPIRED',available_at=now()
       WHERE status='processing' AND locked_at<now()-make_interval(secs=>$1)
       RETURNING id`,[seconds]);
    return {released:(result.rowCount??0)+(deletions.rowCount??0)};
  }
  async claimDeletions(workerId:string,limit=50,ownerUserId?:string) {
    if(!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    if(ownerUserId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId)) {
      throw new BadRequestException('Invalid media owner id.');
    }
    const batch=Math.min(Math.max(Number(limit)||50,1),100);
    const result=await this.db.query(
      `WITH picked AS (
         SELECT d.id FROM media_storage_deletions d
         JOIN media_assets a ON a.id=d.media_asset_id
         WHERE d.status IN ('pending','failed') AND d.available_at<=now() AND d.attempts<8
           AND ($3::uuid IS NULL OR a.owner_id=$3)
         ORDER BY d.available_at,d.created_at LIMIT $1 FOR UPDATE OF d SKIP LOCKED
       )
       UPDATE media_storage_deletions d SET status='processing',attempts=d.attempts+1,locked_at=now(),locked_by=$2
       FROM picked p WHERE d.id=p.id
       RETURNING d.id,d.media_asset_id,d.storage_key,d.storage_provider,d.attempts`,[batch,workerId,ownerUserId??null]);
    return result.rows;
  }

  async completeDeletion(workerId:string,deletionId:string,input:unknown) {
    if(!/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) throw new BadRequestException('Invalid worker id.');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deletionId)) throw new BadRequestException('Invalid deletion id.');
    if(!input||typeof input!=='object'||Array.isArray(input)||typeof (input as Record<string,unknown>).success!=='boolean') throw new BadRequestException('Deletion result is required.');
    const value=input as Record<string,unknown>;
    const result=await this.db.query(
      `UPDATE media_storage_deletions SET status=$3,locked_at=NULL,locked_by=NULL,
         last_error_code=$4,available_at=now()+make_interval(secs=>LEAST(3600,30*(2^LEAST(attempts,7))::integer))
       WHERE id=$1 AND status='processing' AND locked_by=$2
       RETURNING id,status,media_asset_id`,
      [deletionId,workerId,value.success?'completed':'failed',value.success?null:String(value.errorCode??'STORAGE_DELETE_FAILED').slice(0,120)]);
    if(!result.rowCount) throw new NotFoundException('Storage deletion task not found or not owned by this worker.');
    return result.rows[0];
  }

}
