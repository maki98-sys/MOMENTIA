import { BadRequestException,ForbiddenException } from '@nestjs/common';
import { JoinRequestsService } from './join-requests.service';
import { DatabaseService } from '../database/database.service';

describe('JoinRequestsService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new JoinRequestsService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('creates an approval request only for an approval-based public or unlisted circle',async()=>{
  const cq=jest.fn()
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'s1'}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'r1',status:'pending'}]})
   .mockResolvedValueOnce({rowCount:1,rows:[]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.create('u1','s1')).resolves.toMatchObject({id:'r1',status:'pending'});
  expect(cq).toHaveBeenCalledTimes(5);
 });
 it('rejects a banned requester',async()=>{
  const cq=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:'s1'}]}).mockResolvedValueOnce({rowCount:1,rows:[{state:'banned'}]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.create('u1','s1')).rejects.toBeInstanceOf(ForbiddenException);
 });
 it('rejects duplicate pending requests',async()=>{
  const cq=jest.fn().mockResolvedValueOnce({rowCount:1,rows:[{id:'s1'}]}).mockResolvedValueOnce({rowCount:0,rows:[]}).mockResolvedValueOnce({rowCount:1,rows:[{id:'r1'}]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.create('u1','s1')).rejects.toBeInstanceOf(BadRequestException);
 });
 it('approves a pending request by creating an active member and auditing',async()=>{
  const cq=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'r1',requester_id:'u2',status:'pending',space_id:'s1'}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[]});
  transaction.mockImplementationOnce(async(work:(client:unknown)=>Promise<unknown>)=>work({query:cq}));
  await expect(service.review('admin','s1','r1','approved')).resolves.toMatchObject({status:'approved'});
  expect(cq).toHaveBeenCalledTimes(6);
  expect(cq.mock.calls[3][0]).toContain('INSERT INTO space_memberships');
 });
});
