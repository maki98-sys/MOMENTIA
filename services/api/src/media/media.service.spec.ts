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
 it('requires a SHA-256 checksum',async()=>{
  await expect(service.createUpload('u',{fileName:'photo.jpg',sizeBytes:100,checksumSha256:'bad'},'key')).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
});
