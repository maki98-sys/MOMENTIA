import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createMediaWorkerStorage } from './storage';
import sharp from 'sharp';

const API_URL = required('MEDIA_API_URL').replace(/\/$/, '');
const WORKER_TOKEN = required('MEDIA_WORKER_TOKEN');
const MAINTENANCE_TOKEN = process.env.NOTIFICATION_WORKER_TOKEN;
const WORKER_ID = process.env.MEDIA_WORKER_ID ?? `media-worker-${process.pid}`;
let storage = createMediaWorkerStorage();
const POLL_MS = Math.min(Math.max(Number(process.env.MEDIA_WORKER_POLL_MS) || 1500, 250), 30000);
const BATCH_SIZE = Math.min(Math.max(Number(process.env.MEDIA_WORKER_BATCH_SIZE) || 5, 1), 20);

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
      if(settled)return;settled=true;socket.destroy();
      if(error)reject(error);else resolveVerdict(verdict??'unavailable');
    };
    socket.setTimeout(120000,()=>finish(new Error('ClamAV scan timed out')));
    socket.on('error',error=>finish(error));
    socket.on('data',chunk=>{
      response+=chunk.toString('utf8');
      if(response.includes('OK')) finish(undefined,'clean');
      else if(response.includes('FOUND')) finish(undefined,'rejected');
      else if(response.includes('ERROR')) finish(new Error('ClamAV scan failed'));
    });
    socket.on('connect',()=>{
      socket.write('zINSTREAM\0');
      const stream=createReadStream(path,{highWaterMark:64*1024});
      stream.on('data',chunk=>{
        const header=Buffer.alloc(4);header.writeUInt32BE(chunk.length,0);
        if(!socket.write(Buffer.concat([header,chunk]))) stream.pause();
      });
      socket.on('drain',()=>stream.resume());
      stream.on('end',()=>socket.end(Buffer.alloc(4)));
      stream.on('error',error=>finish(error));
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolveProcess,reject)=>{
    const child=spawn(process.env.FFMPEG_PATH??'ffmpeg',args,{stdio:['ignore','ignore','pipe']});
    let errorText='';
    child.stderr.on('data',chunk=>{errorText+=chunk.toString().slice(0,2000);});
    child.on('error',reject);
    child.on('close',code=>code===0?resolveProcess():reject(new Error(`ffmpeg exited ${code}: ${errorText.slice(-500)}`)));
  });
}

async function makeImageVariants(job: Job): Promise<Variant[]> {
  const source=await storage.materialize(job.storage_key_original);
  try {
    const meta=await sharp(source,{failOn:'error'}).metadata();
    if(!meta.width||!meta.height) throw new Error('Image dimensions could not be read');
    const definitions=[{type:'thumbnail' as const,width:320},{type:'preview' as const,width:1280},{type:'display' as const,width:2048}];
    const variants:Variant[]=[];
    for(const definition of definitions) {
      const storageKey=`variants/${job.media_asset_id}/${definition.type}.webp`;
      const target=safePath(storageKey);
      await storage.ensureParent(storageKey);
      try {
        const output=await sharp(source,{failOn:'error'})
          .rotate()
          .resize({width:definition.width,height:definition.width,fit:'inside',withoutEnlargement:true})
          .webp({quality:82,effort:4})
          .toFile(target);
        const checksumSha256=await sha256(target);
        await storage.commit(storageKey,target);
        variants.push({
          variantType:definition.type,storageKey,mimeType:'image/webp',
          sizeBytes:output.size,width:output.width,height:output.height,checksumSha256,
        });
      } finally {
        await storage.release(storageKey).catch(()=>undefined);
      }
    }
    return variants;
  } finally {
    await storage.release(job.storage_key_original).catch(()=>undefined);
  }
}

async function makeVideoPoster(job: Job): Promise<Variant[]> {
  const source=await storage.materialize(job.storage_key_original);
  const storageKey=`variants/${job.media_asset_id}/video_poster.jpg`;
  const target=safePath(storageKey);
  try {
    await storage.ensureParent(storageKey);
    await runFfmpeg(['-nostdin','-y','-ss','1','-i',source,'-frames:v','1','-vf','scale=min(1280\\,iw):-2','-q:v','3',target]);
    const meta=await sharp(target).metadata();
    const info=await stat(target);
    if(!meta.width||!meta.height) throw new Error('Video poster dimensions could not be read');
    const checksumSha256=await sha256(target);
    await storage.commit(storageKey,target);
    return [{
      variantType:'video_poster',storageKey,mimeType:'image/jpeg',
      sizeBytes:info.size,width:meta.width,height:meta.height,checksumSha256,
    }];
  } finally {
    await storage.release(storageKey).catch(()=>undefined);
    await storage.release(job.storage_key_original).catch(()=>undefined);
  }
}

async function processJob(job: Job): Promise<Record<string,unknown>> {
  if(job.job_type==='inspect') {
    const source=await storage.materialize(job.storage_key_original);
    try {
      const info=await stat(source);
      if(info.size!==Number(job.size_bytes)) throw new Error('Stored file size differs from the declared size');
      if(await sha256(source)!==job.checksum_sha256) throw new Error('Stored file checksum mismatch');
      return {success:true,result:{bytes:info.size}};
    } finally { await storage.release(job.storage_key_original).catch(()=>undefined); }
  }
  if(job.job_type==='virus_scan') {
    const source=await storage.materialize(job.storage_key_original);
    try {
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

async function deliverJob(job: Job): Promise<void> {
  try {
    storage = createMediaWorkerStorage(job.storage_provider);
    const result=await processJob(job);
    await api(`/internal/media-processing/jobs/${job.id}/complete`,'POST',{workerId:WORKER_ID,...result});
  } catch(error) {
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
