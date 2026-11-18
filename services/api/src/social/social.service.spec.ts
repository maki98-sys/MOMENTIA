import { BadRequestException } from '@nestjs/common';
import { SocialService } from './social.service';
import { DatabaseService } from '../database/database.service';

describe('SocialService',()=>{
 const query=jest.fn(), transaction=jest.fn();
 const service=new SocialService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('rejects posts without text or media',async()=>{
  await expect(service.create('u1',{audience:'public'})).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('rejects unsupported fields and invalid audience',async()=>{
  await expect(service.create('u1',{body:'hello',isAdmin:true})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.create('u1',{body:'hello',audience:'everyone'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('requires a space for space-only posts',async()=>{
  await expect(service.create('u1',{body:'hello',audience:'space'})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects empty and oversized comments',async()=>{
  await expect(service.addComment('u1','p1',' ')).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.addComment('u1','p1','x'.repeat(3001))).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('rejects unsupported reaction types',async()=>{
  await expect(service.react('u1','p1','admin')).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
});
