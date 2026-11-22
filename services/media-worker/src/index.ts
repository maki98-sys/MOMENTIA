import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parseClamAvResponse, runFfmpeg as executeFfmpeg } from './process-utils';
import { createMediaWorkerStorage } from './storage';
import { renderImageVariant } from './image-processing';
import { assertFileIntegrity } from './file-integrity';
import sharp from 'sharp';

const API_URL = required('MEDIA_API_URL').replace(/\/$/, '');
const WORKER_TOKEN = required('MEDIA_WORKER_TOKEN');
const MAINTENANCE_TOKEN = process.env.NOTIFICATION_WORKER_TOKEN;
const WORKER_ID = process.env.MEDIA_WORKER_ID ?? `media-worker-${process.pid}`;
let storage = createMediaWorkerStorage();
const POLL_MS = Math.min(Math.max(Number(process.env.MEDIA_WORKER_POLL_MS) || 1500, 250), 30000);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.MEDIA_WORKER_BATCH_SIZE) || 5, 1), 20);
const FFMPEG_TIMEOUT_MS = Math.min(Math.max(Number(process.env.MEDIA_FFMPEG_TIMEOUT_MS) || 120000, 1000), 300000);
const MAX_IMAGE_PIXELS = Math.min(Math.max(Number(process.env.MEDIA_MAX_IMAGE_PIXELS) || 40_000_000, 1_000_000), 100_000_000);

type Job = {
  id: string;
  media_asset_id: string;
  job_type: 'inspect'|'virus_scan'|'image_variants'|'video_poster'|'finalize';
  storage_key_original: string;
  mime_type_detected: string;
  size_bytes: number;
  checksum_sha256: string;
  storage_provider: 'local'|'s3';
};
type Variant = {
  variantType: 'thumbnail'|'preview'|'display'|'video_poster';
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  checksumSha256: string;
};

function required(key: string): string {
  const value=process.env[key];
  if(!value) throw new Error(`${key} is required`);
  return value;
}

function safePath(storageKey: string): string { return storage.pathFor(storageKey); }

async function api<T>(path: string, method='POST', body?: unknown, token=WORKER_TOKEN): Promise<T> {
  const response=await fetch(API_URL+path,{
    method,
    headers:{'content-type':'application/json','x-worker-token':token},
    body:body===undefined?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000),
  });
  const raw=await response.text();
  if(!response.ok) throw new Error(`API ${response.status}: ${raw.slice(0,500)}`);
  return raw?JSON.parse(raw) as T:undefined as T;
}

async function sha256(path: string): Promise<string> {
  const hash=createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function clamScan(path: string): Promise<'clean'|'rejected'|'unavailable'> {
  const host=process.env.CLAMD_HOST;
  if(!host) return 'unavailable';
  const port=Math.min(Math.max(Number(process.env.CLAMD_PORT)||3310,1),65535);
  return new Promise((resolveVerdict,reject)=>{
    const socket=createConnection({host,port});
    let response='';
    let settled=false;
    const finish=(error?:Error,verdict?:'clean'|'rejected'|'unavailable')=>{
      if(settled)return;
      settled=true;
      socket.destroy();
      if(error)reject(error);else resolveVerdict(verdict??'unavailable');
    };
    socket.setTimeout(120000,()=>finish(new Error('ClamAV scan timed out')));
    socket.on('error',error=>finish(error));
    socket.on('close',()=>{if(!settled)finish(new Error('ClamAV closed without a complete verdict'));});
    socket.on('data',chunk=>{
      response=(response+chunk.toString('utf8')).slice(-4096);
      try {
        const verdict=parseClamAvResponse(response);
        if(verdict!=='pending') finish(undefined,verdict);
      } catch(error) {
        finish(error instanceof Error?error:new Error('ClamAV scan failed'));
      }
    });
    socket.on('connect',()=>{
      socket.write('zINSTREAM\0');
      const stream=createReadStream(path,{highWaterMark:64*1024});
      stream.on('data',chunk=>{
        const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
        const header=Buffer.alloc(4);header.writeUInt32BE(data.length,0);
        if(!socket.write(Buffer.concat([header,data]))) stream.pause();
      });
      socket.on('drain',()=>stream.resume());
      stream.on('end',()=>socket.end(Buffer.alloc(4)));
      stream.on('error',error=>finish(error));
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  await executeFfmpeg(process.env.FFMPEG_PATH??'ffmpeg',args,FFMPEG_TIMEOUT_MS);
}

async function makeImageVariants(job: Job): Promise<Variant[]> {
  const source=await storage.materialize(job.storage_key_original,Number(job.size_bytes));
  try {
    await assertFileIntegrity(source,Number(job.size_bytes),job.checksum_sha256);
    const meta=await sharp(source,{failOn:'error',limitInputPixels:MAX_IMAGE_PIXELS,sequentialRead:true}).metadata();
    if(!meta.width||!meta.height) throw new Error('Image dimensions could not be read');
    const definitions=[{type:'thumbnail' as const,width:320},{type:'preview' as const,width:1280},{type:'display' as const,width:2048}];
    const variants:Variant[]=[];
    try {
    for(const definition of definitions) {
      const storageKey=`variants/${job.media_asset_id}/${definition.type}.webp`;
      const target=safePath(storageKey);
      await storage.ensureParent(storageKey);
      try {
        const output=await renderImageVariant(source,target,definition.width,MAX_IMAGE_PIXELS);
        const checksumSha256=await sha256(target);
        await storage.commit(storageKey,target,checksumSha256);
        variants.push({
          variantType:definition.type,storageKey,mimeType:'image/webp',
          sizeBytes:output.size,width:output.width,height:output.height,checksumSha256,
        });
      } finally {
        await storage.release(storageKey).catch(()=>undefined);
      }
    }
    return variants;
    } catch(error) {
      // If a later derivative fails, remove every earlier derivative committed
      // by this job so a partial image set cannot be mistaken for a complete one.
      await Promise.all(variants.map(variant=>storage.remove(variant.storageKey).catch(()=>undefined)));
      throw error;
    }
  } finally {
    await storage.release(job.storage_key_original).catch(()=>undefined);
  }
}

async function makeVideoPoster(job: Job): Promise<Variant[]> {
  const source=await storage.materialize(job.storage_key_original,Number(job.size_bytes));
  const storageKey=`variants/${job.media_asset_id}/video_poster.jpg`;
  // Never let FFmpeg write directly over a previously published poster. Local
  // storage atomically renames this staged file; S3 uploads it only after checks.
  const temporaryKey=`${storageKey}.tmp-${job.id}`;
  const target=safePath(temporaryKey);
  try {
    await assertFileIntegrity(source,Number(job.size_bytes),job.checksum_sha256);
    await storage.ensureParent(temporaryKey);
    await runFfmpeg(['-nostdin','-y','-protocol_whitelist','file,pipe','-max_alloc','67108864','-ss','1','-i',source,'-frames:v','1','-vf','scale=min(1280\\,iw):-2','-q:v','3','-fs','20971520',target]);
    const meta=await sharp(target).metadata();
    const info=await stat(target);
    if(!meta.width||!meta.height) throw new Error('Video poster dimensions could not be read');
    const checksumSha256=await sha256(target);
    await storage.commit(storageKey,target,checksumSha256);
    return [{
      variantType:'video_poster',storageKey,mimeType:'image/jpeg',
      sizeBytes:info.size,width:meta.width,height:meta.height,checksumSha256,
    }];
  } finally {
    if(job.storage_provider==='s3') await storage.release(temporaryKey).catch(()=>undefined);
    else await storage.remove(temporaryKey).catch(()=>undefined);
    await storage.release(job.storage_key_original).catch(()=>undefined);
  }
}

async function processJob(job: Job): Promise<Record<string,unknown>> {
  if(job.job_type==='inspect') {
    const source=await storage.materialize(job.storage_key_original,Number(job.size_bytes));
    try {
      const info=await stat(source);
      await assertFileIntegrity(source,Number(job.size_bytes),job.checksum_sha256);
      return {success:true,result:{bytes:info.size}};
    } finally { await storage.release(job.storage_key_original).catch(()=>undefined); }
  }
  if(job.job_type==='virus_scan') {
    const source=await storage.materialize(job.storage_key_original,Number(job.size_bytes));
    try {
      // Scan the exact original accepted by the API, not merely an object with
      // the same length that may have been replaced in storage afterwards.
      await assertFileIntegrity(source,Number(job.size_bytes),job.checksum_sha256);
      const verdict=await clamScan(source);
      return {success:true,scanVerdict:verdict,result:{scanner:process.env.CLAMD_HOST?'clamd':'not_configured'}};
    } finally { await storage.release(job.storage_key_original).catch(()=>undefined); }
  }
  if(job.job_type==='image_variants') {
    const variants=await makeImageVariants(job);
    return {success:true,variants,result:{variantCount:variants.length}};
  }
  if(job.job_type==='video_poster') {
    const variants=await makeVideoPoster(job);
    return {success:true,variants,result:{variantCount:variants.length}};
  }
  if(job.job_type==='finalize') return {success:true,result:{finalizedAt:new Date().toISOString()}};
  throw new Error('Unsupported media job');
}

async function removeUncommittedVariants(result: Record<string,unknown>): Promise<void> {
  if(!Array.isArray(result.variants)) return;
  for(const variant of result.variants) {
    if(!variant||typeof variant!=='object'||typeof (variant as Record<string,unknown>).storageKey!=='string') continue;
    await storage.remove(String((variant as Record<string,unknown>).storageKey)).catch(error=>{
      process.stderr.write(`orphan variant cleanup failed: ${String(error)}\\n`);
    });
  }
}

async function deliverJob(job: Job): Promise<void> {
  let result:Record<string,unknown>|undefined;
  try {
    storage = createMediaWorkerStorage(job.storage_provider);
    result=await processJob(job);
    const completion=await api<{status?:string}>(`/internal/media-processing/jobs/${job.id}/complete`,'POST',{workerId:WORKER_ID,...result});
    // The API may have cancelled a job because its asset was deleted or failed
    // while the worker was generating variants. Those objects were never committed
    // to media_variants and must not be left orphaned in object storage.
    if(completion?.status==='cancelled') await removeUncommittedVariants(result);
  } catch(error) {
    // A 404 means the lease was revoked (for example, by asset deletion). The
    // completion transaction did not persist these variants, so remove them.
    // Do not clean up on ambiguous network/5xx errors: the DB may have committed.
    if(result&&/API 404:/.test(String(error))) await removeUncommittedVariants(result);
    const errorCode=error instanceof Error?error.name||'WORKER_ERROR':'WORKER_ERROR';
    await api(`/internal/media-processing/jobs/${job.id}/complete`,'POST',{
      workerId:WORKER_ID,success:false,errorCode,
    });
    process.stderr.write(`job ${job.id} failed: ${String(error)}\\n`);
  }
}

async function processDeletion(deletion: {id:string;storage_key:string;storage_provider:'local'|'s3'}): Promise<boolean> {
  try {
    storage = createMediaWorkerStorage(deletion.storage_provider);
    await storage.remove(deletion.storage_key);
    await api(`/internal/media-processing/deletions/${deletion.id}/complete`,'POST',{
      workerId:WORKER_ID,success:true,
    });
    return true;
  } catch(error) {
    await api(`/internal/media-processing/deletions/${deletion.id}/complete`,'POST',{
      workerId:WORKER_ID,success:false,errorCode:error instanceof Error?error.name:'DELETE_FAILED',
    });
    process.stderr.write(`deletion ${deletion.id} failed: ${String(error)}\\n`);
    return false;
  }
}

type AccountDeletion = {id:string;user_id:string;processing_attempts:number};

const maintenanceLastRun: Record<string,number> = {};

async function runScheduledTask(name:string,intervalMs:number,path:string,body:unknown={}):Promise<void> {
  if(!MAINTENANCE_TOKEN) return;
  const now=Date.now();
  if(now-(maintenanceLastRun[name]??0)<intervalMs) return;
  try {
    await api(path,'POST',body,MAINTENANCE_TOKEN);
    maintenanceLastRun[name]=now;
  } catch(error) {
    process.stderr.write(`scheduled task ${name} failed: ${String(error)}\\n`);
  }
}

async function runMediaLeaseRecovery():Promise<void> {
  const name='media-lease-recovery';
  const now=Date.now();
  if(now-(maintenanceLastRun[name]??0)<60000) return;
  try {
    await api('/internal/media-processing/leases/recover','POST',{staleSeconds:300},WORKER_TOKEN);
    maintenanceLastRun[name]=now;
  } catch(error) {
    process.stderr.write(`scheduled task ${name} failed: ${String(error)}\\n`);
  }
}

async function runMaintenance():Promise<void> {
  if(!MAINTENANCE_TOKEN) return;
  await runScheduledTask('push-dispatch',5000,'/internal/notifications/push/dispatch');
  await runMediaLeaseRecovery();
  await runScheduledTask('push-recovery',60000,'/internal/notifications/push/recover-stale');
  await runScheduledTask('event-reminders',60000,'/internal/events/queue-reminders');
  await runScheduledTask('event-archive',900000,'/internal/events/archive-ended');
  await runScheduledTask('audio-presence-cleanup',30000,'/internal/audio/cleanup-stale-participants',{staleAfterSeconds:45});
}

async function tick(): Promise<void> {
  await runMaintenance();
  await api('/internal/media-processing/uploads/cleanup-expired','POST',{limit:100});
  const accountDeletions=await api<AccountDeletion[]>('/internal/deletions/claim','POST',{
    workerId:WORKER_ID,limit:5,
  });
  const jobs=await api<Job[]>('/internal/media-processing/jobs/claim','POST',{workerId:WORKER_ID,limit:BATCH_SIZE});
  for(const job of jobs??[]) await deliverJob(job);

  for(const request of accountDeletions??[]) {
    let accountDeletionFailures=0;
    try {
      for(let batch=0;batch<100;batch++) {
        const deletions=await api<Array<{id:string;storage_key:string;storage_provider:'local'|'s3'}>>('/internal/media-processing/deletions/claim','POST',{
          workerId:WORKER_ID,limit:100,ownerUserId:request.user_id,
        });
        if(!deletions?.length) break;
        for(const deletion of deletions) {
          if(!await processDeletion(deletion)) accountDeletionFailures++;
        }
        if(deletions.length<100) break;
      }
      await api(`/internal/deletions/${request.id}/complete`,'POST',{
        workerId:WORKER_ID,
        success:accountDeletionFailures===0,
        ...(accountDeletionFailures===0?{purged:true}:{errorCode:'MEDIA_STORAGE_DELETE_FAILED'}),
      });
    } catch(error) {
      process.stderr.write(`account deletion ${request.id} not finalized: ${String(error)}\\n`);
    }
  }

  // Process ordinary user-requested deletions independently of account purges.
  for(let batch=0;batch<100;batch++) {
    const deletions=await api<Array<{id:string;storage_key:string;storage_provider:'local'|'s3'}>>('/internal/media-processing/deletions/claim','POST',{
      workerId:WORKER_ID,limit:50,
    });
    if(!deletions?.length) break;
    for(const deletion of deletions) await processDeletion(deletion);
    if(deletions.length<50) break;
  }
  await api('/internal/media-processing/leases/recover','POST',{staleSeconds:300});
}

async function main() {
  process.stdout.write(`MOMENTIA media worker ${WORKER_ID} started\\n`);
  for(;;) {
    try { await tick(); }
    catch(error) { process.stderr.write(`worker cycle failed: ${String(error)}\\n`); }
    await new Promise(resolveDelay=>setTimeout(resolveDelay,POLL_MS));
  }
}

main().catch(error=>{process.stderr.write(String(error)+'\\n');process.exitCode=1;});
