import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CoupleInvitationsService } from './couple-invitations.service';
import { DatabaseService } from '../database/database.service';

describe('CoupleInvitationsService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new CoupleInvitationsService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('validates invitee UUID and rejects unsupported fields',()=>{
  expect(()=>service.validateCreateInput({inviteeUserId:'bad'})).toThrow(BadRequestException);
  expect(()=>service.validateCreateInput({inviteeUserId:'00000000-0000-4000-8000-000000000001',role:'owner'})).toThrow(BadRequestException);
 });
 it('requires two active accounts before creating an invitation',async()=>{
  const cq=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{}]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.create('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')).rejects.toBeTruthy();
  expect(cq).toHaveBeenCalledTimes(1);
 });
 it('creates the private couple space only after the invitee accepts',async()=>{
  const cq=jest.fn()
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'i1',inviter_user_id:'00000000-0000-4000-8000-000000000001',invitee_user_id:'00000000-0000-4000-8000-000000000002',expires_at:new Date(Date.now()+60000).toISOString(),accepted_at:null,revoked_at:null}]})
   .mockResolvedValueOnce({rowCount:2,rows:[{id:'00000000-0000-4000-8000-000000000001'},{id:'00000000-0000-4000-8000-000000000002'}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{features:{couple_journal:true},max_spaces:5,owned_spaces:0}]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'space1'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:2,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.accept('00000000-0000-4000-8000-000000000002','a'.repeat(43))).resolves.toMatchObject({type:'COUPLE',visibility:'private'});
  expect(cq).toHaveBeenCalledTimes(9);
  expect(cq.mock.calls[1][0]).toContain('ORDER BY id FOR UPDATE');
  expect(cq.mock.calls[6][0]).toContain("'owner','active'");
 });
 it('does not allow another user to accept the token',async()=>{
  const cq=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:'i1',inviter_user_id:'00000000-0000-4000-8000-000000000001',invitee_user_id:'00000000-0000-4000-8000-000000000002',expires_at:new Date(Date.now()+60000).toISOString(),accepted_at:null,revoked_at:null}]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.accept('00000000-0000-4000-8000-000000000003','b'.repeat(43))).rejects.toBeInstanceOf(ForbiddenException);
  expect(cq).toHaveBeenCalledTimes(1);
 });
});
