import { BadRequestException } from '@nestjs/common';
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
});
