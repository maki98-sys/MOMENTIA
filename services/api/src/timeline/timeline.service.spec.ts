import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { DatabaseService } from '../database/database.service';

describe('TimelineService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new TimelineService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('requires exactly one source object',async()=>{
  await expect(service.add('u','s',{})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.add('u','s',{postId:'p',mediaAssetId:'m'})).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('rejects unsupported fields and invalid source',async()=>{
  await expect(service.add('u','s',{mediaAssetId:'m',unexpected:true})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.add('u','s',{mediaAssetId:'m',source:'system'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects invalid event time',async()=>{
  await expect(service.add('u','s',{mediaAssetId:'m',occurredAt:'yesterday-ish'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('filters blocked authors and inaccessible media from timeline reads',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:1,rows:[]})
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{ok:1}]});
  transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
  await expect(service.list('u1','s1')).resolves.toEqual([]);
  expect(clientQuery.mock.calls[1][0]).toContain('user_blocks');
  expect(clientQuery.mock.calls[1][0]).toContain('post_author.id IS NOT NULL');
  expect(clientQuery.mock.calls[1][0]).toContain('media_owner.id IS NOT NULL');
  expect(clientQuery.mock.calls[1][0]).toContain("p.audience='public'");
  expect(clientQuery.mock.calls[1][1]).toEqual(['u1','s1',null,null,30]);
  expect(clientQuery.mock.calls[2][0]).toContain("viewer.status='active'");
 });
 it('rejects adding a post with an incompatible audience or blocked author',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{role:'member'}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
  await expect(service.add('u1','s1',{postId:'post-id'})).rejects.toBeInstanceOf(NotFoundException);
  expect(clientQuery.mock.calls[2][0]).toContain("audience='space'");
  expect(clientQuery.mock.calls[2][0]).toContain('user_blocks');
 });

});
