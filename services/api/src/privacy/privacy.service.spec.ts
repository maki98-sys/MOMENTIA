import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PrivacyService } from './privacy.service';

describe('PrivacyService',()=>{
  const query=jest.fn();
  const transaction=jest.fn();
  const service=new PrivacyService({query,transaction} as unknown as DatabaseService);
  const userId='11111111-1111-4111-8111-111111111111';
  const requestId='22222222-2222-4222-8222-222222222222';
  const worker='privacy-worker-01';

  beforeEach(()=>{query.mockReset();transaction.mockReset();});

  it('exports all user datasets in one read-only repeatable-read transaction',async()=>{
    const clientQuery=jest.fn().mockResolvedValue({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const result=await service.exportMyData(userId);
    expect(result).toMatchObject({format:'momentia-data-export-v1',consistency:'repeatable_read'});
    expect(result.data).toHaveProperty('account');
    expect(result.data).toHaveProperty('coupleJournalEntries');
    expect(result.data).toHaveProperty('audioParticipations');
    expect(clientQuery.mock.calls[0][0]).toContain('REPEATABLE READ, READ ONLY');
    expect(clientQuery.mock.calls.length).toBeGreaterThan(30);
  });

  it('requests account deletion, revokes sessions and devices, and cancels push outbox work',async()=>{
    const scheduledFor=new Date(Date.now()+30*24*60*60*1000);
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:userId,status:'active'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:requestId,status:'pending',requested_at:new Date(),scheduled_for:scheduledFor}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:2})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:3})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.requestDeletion(userId)).resolves.toMatchObject({
      id:requestId,status:'pending',gracePeriodDays:30,sessionsRevoked:true,
    });
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[4][0]).toContain('UPDATE auth_sessions');
    expect(clientQuery.mock.calls[5][0]).toContain('UPDATE devices');
    expect(clientQuery.mock.calls[6][0]).toContain("last_error_code='ACCOUNT_DELETION_PENDING'");
  });

  it('does not allow a non-active account to request deletion',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:userId,status:'deletion_pending'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.requestDeletion(userId)).rejects.toBeInstanceOf(ConflictException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('validates worker identity and deletion batch limits before claiming work',async()=>{
    await expect(service.claimDueDeletionRequests('x',10)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.claimDueDeletionRequests(worker,0)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('claims due deletion requests under the authorization write lock',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.claimDueDeletionRequests(worker,50)).resolves.toEqual([]);
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[2][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(clientQuery.mock.calls[2][1]).toEqual([25,worker]);
  });

  it('rejects invalid worker results and deletion identifiers',async()=>{
    await expect(service.completeDeletionRequest('x',requestId,{success:false})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.completeDeletionRequest(worker,'bad-id',{success:true,purged:true})).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.completeDeletionRequest(worker,requestId,{success:true})).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects completion when the worker does not own an active deletion lease',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.completeDeletionRequest(worker,requestId,{success:true,purged:true}))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('retries a failed purge while attempts remain',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:requestId,user_id:userId,processing_attempts:3}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:requestId,status:'pending',processing_attempts:3,last_error_code:'PURGE_RETRY'}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.completeDeletionRequest(worker,requestId,{success:false,errorCode:'PURGE_RETRY'}))
      .resolves.toMatchObject({id:requestId,status:'pending',retryable:true});
    expect(clientQuery.mock.calls[2][0]).toContain("status=CASE WHEN processing_attempts>=8 THEN 'failed' ELSE 'pending' END");
  });

  it('does not complete account purge while media remains',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:requestId,user_id:userId,processing_attempts:2}],rowCount:1})
      .mockResolvedValueOnce({rows:[{total:1}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.completeDeletionRequest(worker,requestId,{success:true,purged:true}))
      .rejects.toBeInstanceOf(ConflictException);
    expect(clientQuery).toHaveBeenCalledTimes(5);
  });

  it('completes a purge only after all media and storage tasks are cleared',async()=>{
    const clientQuery=jest.fn().mockImplementation(async(sql:string)=>{
      if(sql.includes('SELECT id,user_id,processing_attempts')) return {rows:[{id:requestId,user_id:userId,processing_attempts:3}],rowCount:1};
      if(sql.includes('SELECT count(*)::int total')) return {rows:[{total:0}],rowCount:1};
      if(sql.includes('SELECT id,type,status FROM spaces')) return {rows:[],rowCount:0};
      if(sql.includes('RETURNING id,status,completed_at')) return {rows:[{id:requestId,status:'completed',completed_at:new Date()}],rowCount:1};
      return {rows:[],rowCount:0};
    });
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.completeDeletionRequest(worker,requestId,{success:true,purged:true}))
      .resolves.toMatchObject({id:requestId,status:'completed'});
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls.some(call=>String(call[0]).includes('DELETE FROM sync_snapshot_sessions'))).toBe(true);
    expect(clientQuery.mock.calls[clientQuery.mock.calls.length-1][0]).toContain('account.deletion_completed');
    expect(clientQuery.mock.calls.length).toBeGreaterThan(30);
  });

  it('cancels a pending deletion request and reactivates the account',async()=>{
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{id:userId,status:'deletion_pending'}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:requestId}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.cancelDeletion(userId)).resolves.toEqual({cancelled:true,requestId});
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[3][0]).toContain("status='active'");
  });

  it('returns null when the account has no deletion request',async()=>{
    query.mockResolvedValueOnce({rows:[],rowCount:0});
    await expect(service.getDeletionStatus(userId)).resolves.toEqual({request:null});
  });
});
