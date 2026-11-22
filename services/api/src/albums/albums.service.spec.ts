import { BadRequestException } from '@nestjs/common';
import { AlbumsService } from './albums.service';
import { DatabaseService } from '../database/database.service';
describe('AlbumsService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new AlbumsService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('requires active membership and album visibility before listing album items',async()=>{
  const clientQuery=jest.fn()
   .mockResolvedValueOnce({rowCount:0,rows:[]})
   .mockResolvedValueOnce({rowCount:1,rows:[{id:'a1',visibility:'members',role:'member'}]})
   .mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
  await expect(service.listItems('u1','s1','a1')).resolves.toMatchObject({items:[],nextCursor:null});
  expect(clientQuery.mock.calls[1][0]).toContain("sm.state='active'");
  expect(clientQuery.mock.calls[2][0]).toContain("m.status='ready'");
  expect(clientQuery.mock.calls[2][0]).toContain("added_by.status='active'");
  expect(clientQuery.mock.calls[2][0]).toContain("media_owner.status='active'");
 });
 it('rejects malformed album item cursors',async()=>{
  await expect(service.listItems('u1','s1','a1','bad','not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
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
