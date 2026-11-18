import { BadRequestException } from '@nestjs/common';
import { AlbumsService } from './albums.service';
import { DatabaseService } from '../database/database.service';
describe('AlbumsService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new AlbumsService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('validates album name and visibility',async()=>{
  await expect(service.create('u','s',{name:' '})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.create('u','s',{name:'Album',visibility:'public'})).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('validates item media and caption',async()=>{
  await expect(service.addItem('u','s','a',{})).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.addItem('u','s','a',{mediaAssetId:'m',caption:'x'.repeat(501)})).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects unsupported fields',async()=>{
  await expect(service.create('u','s',{name:'Album',owner:true})).rejects.toBeInstanceOf(BadRequestException);
 });
});
