import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ModerationService } from './moderation.service';
import { DatabaseService } from '../database/database.service';

describe('ModerationService',()=>{
  const query=jest.fn(),transaction=jest.fn();
  const service=new ModerationService({query,transaction} as unknown as DatabaseService);
  const previousModerators=process.env.MOMENTIA_MODERATOR_USER_IDS;
  beforeEach(()=>{
    query.mockReset();
    transaction.mockReset();
    process.env.MOMENTIA_MODERATOR_USER_IDS='moderator-1';
  });
  afterAll(()=>{
    if(previousModerators===undefined) delete process.env.MOMENTIA_MODERATOR_USER_IDS;
    else process.env.MOMENTIA_MODERATOR_USER_IDS=previousModerators;
  });

  it('only hides a post that is currently published',async()=>{
    const postId='00000000-0000-4000-8000-000000000010';
    const reportId='00000000-0000-4000-8000-000000000011';
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0}) // authorization write lock
      .mockResolvedValueOnce({rows:[{id:reportId,target_type:'post',target_id:postId,status:'open'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:postId}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:reportId,status:'resolved'}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.review('moderator-1',reportId,{decision:'resolve',action:'hide'})).resolves.toMatchObject({status:'resolved'});
    expect(clientQuery.mock.calls[2][0]).toContain("status=$3");
    expect(clientQuery.mock.calls[2][1]).toEqual([postId,'hidden','published']);
  });

  it('does not restore a space that was not hidden by moderation',async()=>{
    const spaceId='00000000-0000-4000-8000-000000000020';
    const reportId='00000000-0000-4000-8000-000000000021';
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:reportId,target_type:'space',target_id:spaceId,status:'open'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{action:'none'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.review('moderator-1',reportId,{decision:'resolve',action:'restore'})).rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(3);
  });

  it('queues object storage deletion when moderation removes media',async()=>{
    const mediaId='00000000-0000-4000-8000-000000000030';
    const reportId='00000000-0000-4000-8000-000000000031';
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:reportId,target_type:'media',target_id:mediaId,status:'open'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:mediaId,owner_id:'owner-1',size_bytes:100,storage_key_original:'original/a',storage_provider:'local'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{storage_key:'variants/a',size_bytes:20,storage_provider:'local'}],rowCount:1})
      .mockResolvedValue({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.review('moderator-1',reportId,{decision:'resolve',action:'remove_media'})).resolves.toMatchObject({status:'resolved'});
    const sql=clientQuery.mock.calls.map((call:any[])=>String(call[0]));
    expect(sql.some((statement:string)=>statement.includes('INSERT INTO media_storage_deletions'))).toBe(true);
    expect(sql.some((statement:string)=>statement.includes('UPDATE media_assets SET status=\'deleted\''))).toBe(true);
    const usageCall=clientQuery.mock.calls.find((call:any[])=>String(call[0]).includes('INSERT INTO storage_usage_events'));
    expect(usageCall?.[1]?.[3]).toBe('moderation-delete:'+mediaId);
  });

  it('rejects moderation actions from non-moderators',async()=>{
    await expect(service.queue('ordinary-user')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not apply enforcement actions when a report is dismissed',async()=>{
    await expect(service.review('moderator-1','00000000-0000-4000-8000-000000000040',{
      decision:'dismiss',action:'hide',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

});
