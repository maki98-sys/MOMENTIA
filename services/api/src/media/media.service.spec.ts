import { BadRequestException } from '@nestjs/common';
import { MediaService } from './media.service';
import { DatabaseService } from '../database/database.service';
describe('MediaService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new MediaService({query,transaction} as unknown as DatabaseService);
 beforeEach(()=>{query.mockReset();transaction.mockReset();});
 it('requires idempotency key',async()=>{
  await expect(service.createUpload('u',{fileName:'photo.jpg',sizeBytes:100,checksumSha256:'a'.repeat(64)},'')).rejects.toBeInstanceOf(BadRequestException);
 });
 it('rejects unsafe names and oversized files',async()=>{
  await expect(service.createUpload('u',{fileName:'../photo.jpg',sizeBytes:100,checksumSha256:'a'.repeat(64)},'key')).rejects.toBeInstanceOf(BadRequestException);
  await expect(service.createUpload('u',{fileName:'photo.jpg',sizeBytes:50*1024*1024+1,checksumSha256:'a'.repeat(64)},'key')).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('rejects malformed upload ids before querying storage',async()=>{
  await expect(service.receiveUpload('u','not-a-uuid',Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
 });
 it('rejects a missing owned upload',async()=>{
  query.mockResolvedValue({rowCount:0,rows:[]});
  await expect(service.receiveUpload('u','123e4567-e89b-42d3-a456-426614174000',Buffer.from('x'))).rejects.toMatchObject({status:404});
 });
 it('rejects mismatched byte counts before writing a file',async()=>{
  query.mockResolvedValue({rowCount:1,rows:[{id:'123e4567-e89b-42d3-a456-426614174000',state:'created',uploader_id:'u',media_asset_id:'a',size_bytes:2,checksum_sha256:'a'.repeat(64),storage_key_original:'pending/u/a',declared_mime_type:'image/jpeg'}]});
  await expect(service.receiveUpload('u','123e4567-e89b-42d3-a456-426614174000',Buffer.from('x'))).rejects.toBeInstanceOf(BadRequestException);
 });
 it('requires a SHA-256 checksum',async()=>{
  await expect(service.createUpload('u',{fileName:'photo.jpg',sizeBytes:100,checksumSha256:'bad'},'key')).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
});
