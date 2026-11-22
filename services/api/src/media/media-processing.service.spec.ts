import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MediaProcessingService } from './media-processing.service';

describe('MediaProcessingService',()=>{
  const query=jest.fn();
  const transaction=jest.fn();
  const service=new MediaProcessingService({query,transaction} as unknown as DatabaseService);
  const worker='media-worker-01';
  const jobId='11111111-1111-4111-8111-111111111111';
  const assetId='22222222-2222-4222-8222-222222222222';
  const deletionId='33333333-3333-4333-8333-333333333333';
  const variant={
    variantType:'thumbnail',storageKey:'variants/22222222-2222-4222-8222-222222222222/thumb.webp',mimeType:'image/webp',
    sizeBytes:2048,width:320,height:240,checksumSha256:'a'.repeat(64),
  };

  beforeEach(()=>{query.mockReset();transaction.mockReset();});

  it('rejects invalid worker identifiers before claiming jobs',async()=>{
    await expect(service.claim('x')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('claims a bounded batch with SKIP LOCKED and loads asset metadata',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:jobId}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'virus_scan'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.claim(worker,1000)).resolves.toHaveLength(1);
    expect(clientQuery.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(clientQuery.mock.calls[0][1]).toEqual([50,worker]);
    expect(clientQuery.mock.calls[1][0]).toContain('storage_key_original');
  });

  it('records a clean virus scan and schedules the correct variant stage',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'virus_scan',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'local',asset_status:'processing'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true,scanVerdict:'clean'}))
      .resolves.toMatchObject({jobId,status:'completed',mediaAssetId:assetId,nextStage:'variants'});
    expect(clientQuery.mock.calls[2][0]).toContain('moderation_scan_status');
    expect(clientQuery.mock.calls[3][0]).toContain('VALUES($1,$2)');
    expect(clientQuery.mock.calls[3][1]).toEqual([assetId,'image_variants']);
    expect(clientQuery.mock.calls[4][0]).toContain("status='completed'");
  });

  it('keeps media quarantined and reports blocked when virus scanning is unavailable',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'virus_scan',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'local',asset_status:'quarantined'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true,scanVerdict:'unavailable'}))
      .resolves.toMatchObject({jobId,status:'completed',mediaAssetId:assetId,nextStage:'blocked'});
    expect(clientQuery.mock.calls[2][0]).toContain("CASE WHEN $2='rejected' THEN 'quarantined' ELSE status END");
    expect(clientQuery.mock.calls[2][1]).toEqual([assetId,'unavailable']);
    expect(clientQuery.mock.calls[3][0]).toContain("status='completed'");
    expect(clientQuery.mock.calls.some(call=>String(call[0]).includes('INSERT INTO media_processing_jobs'))).toBe(false);
  });

  it('rejects a variant result with unsafe storage keys',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'image_variants',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'local',asset_status:'processing'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true,variants:[{...variant,storageKey:'variants/../secret'}]}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('rejects a variant key belonging to a different media asset',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'image_variants',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'local',asset_status:'processing'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true,variants:[{...variant,storageKey:'variants/33333333-3333-4333-8333-333333333333/thumb.webp'}]}))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('persists validated variants and schedules finalization',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'image_variants',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'s3',asset_status:'processing'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true,variants:[variant]}))
      .resolves.toMatchObject({status:'completed',nextStage:'continue'});
    expect(clientQuery.mock.calls[2][0]).toContain('INSERT INTO media_variants');
    expect(clientQuery.mock.calls[2][1][8]).toBe('s3');
    expect(clientQuery.mock.calls[3][0]).toContain("'finalize'");
  });

  it('finalizes only scanned media with at least one variant',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:jobId,media_asset_id:assetId,job_type:'finalize',attempts:1,max_attempts:5,mime_type_detected:'image/jpeg',storage_provider:'local',asset_status:'processing'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{status:'processing',moderation_scan_status:'clean'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{total:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.complete(worker,jobId,{success:true}))
      .resolves.toMatchObject({status:'completed',nextStage:'ready'});
    expect(clientQuery.mock.calls[3][0]).toContain('count(*)');
    expect(clientQuery.mock.calls[4][0]).toContain("status='ready'");
    expect(clientQuery.mock.calls[5][0]).toContain("state='completed'");
  });

  it('releases stale processing and deletion leases under the authorization lock',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{media_asset_id:assetId,attempts:5,max_attempts:5}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:deletionId},{id:'44444444-4444-4444-8444-444444444444'}],rowCount:2});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.releaseStaleLocks(10)).resolves.toEqual({released:3});
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[2][0]).toContain("status='failed'");
    expect(clientQuery.mock.calls[3][0]).toContain('media_storage_deletions');
  });

  it('cleans expired uploads without issuing unnecessary part queries',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.cleanupExpiredUploads(1000))
      .resolves.toEqual({expired:0,storageDeletions:[],removedParts:0});
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[1][0]).toContain('media_uploads');
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('claims and completes storage deletion tasks for the owning worker',async()=>{
    query.mockResolvedValueOnce({rows:[{id:deletionId,media_asset_id:assetId,storage_key:'original/key',storage_provider:'s3',attempts:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:deletionId,status:'completed',media_asset_id:assetId}],rowCount:1});
    await expect(service.claimDeletions(worker,1000)).resolves.toHaveLength(1);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE OF d SKIP LOCKED');
    expect(query.mock.calls[0][0]).toContain('d.attempts<d.max_attempts');
    expect(query.mock.calls[0][0]).toContain('d.dead_lettered_at IS NULL');
    await expect(service.completeDeletion(worker,deletionId,{success:true}))
      .resolves.toMatchObject({id:deletionId,status:'completed'});
    expect(query.mock.calls[1][1]).toEqual([deletionId,worker,'completed',null]);
  });


  it('dead-letters a storage deletion after its bounded retry budget is exhausted',async()=>{
    query.mockResolvedValueOnce({
      rows:[{id:deletionId,status:'failed',media_asset_id:assetId,dead_lettered_at:'2026-11-22T00:00:00.000Z'}],
      rowCount:1,
    });
    await expect(service.completeDeletion(worker,deletionId,{success:false,errorCode:'S3_UNAVAILABLE'}))
      .resolves.toMatchObject({id:deletionId,status:'failed',dead_lettered_at:expect.any(String)});
    expect(query.mock.calls[0][0]).toContain('attempts>=max_attempts');
    expect(query.mock.calls[0][0]).toContain('dead_lettered_at');
    expect(query.mock.calls[0][0]).toContain('RETRY_EXHAUSTED:');
  });

  it('rejects completion by a worker that does not own the deletion task',async()=>{
    query.mockResolvedValueOnce({rows:[],rowCount:0});
    await expect(service.completeDeletion(worker,deletionId,{success:true}))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
