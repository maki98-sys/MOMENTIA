import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaService } from './media.service';
import { DatabaseService } from '../database/database.service';
import { LocalMediaStorage } from './media-storage.service';

describe('MediaService',()=>{
 const query=jest.fn(),transaction=jest.fn();
 const service=new MediaService({query,transaction} as unknown as DatabaseService, new LocalMediaStorage());
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
 it('rejects bytes whose SHA-256 does not match the upload declaration',async()=>{
  query.mockResolvedValue({rowCount:1,rows:[{id:'123e4567-e89b-42d3-a456-426614174000',state:'created',uploader_id:'u',media_asset_id:'a',size_bytes:1,checksum_sha256:'a'.repeat(64),storage_key_original:'pending/u/a',declared_mime_type:'image/jpeg'}]});
  await expect(service.receiveUpload('u','123e4567-e89b-42d3-a456-426614174000',Buffer.from('x'))).rejects.toThrow('SHA-256 checksum mismatch.');
  expect(transaction).not.toHaveBeenCalled();
 });
 it('persists matching bytes and keeps the asset quarantined',async()=>{
  const root=await mkdtemp(join(tmpdir(),'momentia-media-'));
  const previous=process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR=root;
  const bytes=Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00]);
  const uploadId='123e4567-e89b-42d3-a456-426614174000';
  query.mockResolvedValueOnce({rowCount:1,rows:[{
   id:uploadId,state:'created',uploader_id:'u',media_asset_id:'asset-1',
   size_bytes:bytes.length,checksum_sha256:createHash('sha256').update(bytes).digest('hex'),
   storage_key_original:'pending/u/asset-1',declared_mime_type:'image/jpeg',
  }]});
  query.mockResolvedValueOnce({rowCount:1,rows:[{id:uploadId,state:'uploaded',media_asset_id:'asset-1',asset_status:'quarantined'}]});
  transaction.mockImplementation(async (operation:(client:unknown)=>Promise<unknown>) =>
   operation({query:jest.fn().mockResolvedValue({rowCount:1,rows:[]})}));
  try {
   const uploadService=new MediaService({query,transaction} as unknown as DatabaseService,new LocalMediaStorage());
   const result=await uploadService.receiveUpload('u',uploadId,bytes);
   const stored=await readFile(join(root,'pending','u','asset-1'));
   expect(stored).toEqual(bytes);
   expect(result).toMatchObject({state:'uploaded',asset_status:'quarantined'});
   expect(transaction).toHaveBeenCalledTimes(1);
  } finally {
   if(previous===undefined) delete process.env.MEDIA_STORAGE_DIR;
   else process.env.MEDIA_STORAGE_DIR=previous;
   await rm(root,{recursive:true,force:true});
  }
 });
 it('requires a SHA-256 checksum',async()=>{
  await expect(service.createUpload('u',{fileName:'photo.jpg',sizeBytes:100,checksumSha256:'bad'},'key')).rejects.toBeInstanceOf(BadRequestException);
  expect(transaction).not.toHaveBeenCalled();
 });
 it('does not expose shared media owned by suspended accounts',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect((service as any).findViewableAsset('viewer-1','asset-1')).rejects.toBeInstanceOf(NotFoundException);
  expect(query.mock.calls[0][0]).toContain("asset_owner.status='active'");
  expect(query.mock.calls[0][0]).toContain("post_author.status='active'");
  expect(query.mock.calls[0][0]).toContain("album_adder.status='active'");
 });

});
