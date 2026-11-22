import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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
 it('checks upload ownership before accepting a request body',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  await expect(service.assertUploadOwner('attacker','123e4567-e89b-42d3-a456-426614174000'))
   .rejects.toBeInstanceOf(NotFoundException);
  expect(query).toHaveBeenCalledWith(
   'SELECT 1 FROM media_uploads WHERE id=$1 AND uploader_id=$2',
   ['123e4567-e89b-42d3-a456-426614174000','attacker'],
  );
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
 it('streams a staged resumable part after validating its checksum and ownership',async()=>{
  const root=await mkdtemp(join(tmpdir(),'momentia-part-stream-'));
  const previous=process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR=root;
  const bytes=Buffer.from('part-stream-content');
  const staged=join(root,'part.bin');
  const uploadId='123e4567-e89b-42d3-a456-426614174000';
  await writeFile(staged,bytes);
  query.mockResolvedValueOnce({rowCount:1,rows:[{id:uploadId,state:'created',size_bytes:100,storage_provider:'local'}]});
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  transaction.mockImplementation(async(operation:(client:unknown)=>Promise<unknown>)=>{
   const clientQuery=jest.fn()
    .mockResolvedValueOnce({rowCount:1,rows:[{state:'created',size_bytes:100}]})
    .mockResolvedValueOnce({rowCount:1,rows:[{total:0}]})
    .mockResolvedValueOnce({rowCount:1,rows:[{part_number:0}]})
    .mockResolvedValueOnce({rowCount:1,rows:[]});
   return operation({query:clientQuery});
  });
  try {
   const storage=new LocalMediaStorage();
   const uploadService=new MediaService({query,transaction} as unknown as DatabaseService,storage);
   const result=await uploadService.receiveUploadPartFile('u',uploadId,0,staged,bytes.length,createHash('sha256').update(bytes).digest('hex'));
   expect(result).toMatchObject({uploadId,partNumber:0,received:true,duplicate:false});
   expect(await readFile(join(root,'parts/u/'+uploadId+'/0-'+createHash('sha256').update(bytes).digest('hex')))).toEqual(bytes);
  } finally {
   if(previous===undefined) delete process.env.MEDIA_STORAGE_DIR;
   else process.env.MEDIA_STORAGE_DIR=previous;
   await rm(root,{recursive:true,force:true});
  }
 });
 it('rejects staged resumable parts with a mismatched checksum before database access',async()=>{
  const root=await mkdtemp(join(tmpdir(),'momentia-part-stream-invalid-'));
  const staged=join(root,'part.bin');
  const bytes=Buffer.from('part-stream-content');
  await writeFile(staged,bytes);
  try {
   await expect(service.receiveUploadPartFile('u','123e4567-e89b-42d3-a456-426614174000',0,staged,bytes.length,'0'.repeat(64)))
    .rejects.toThrow('Part checksum mismatch.');
   expect(query).not.toHaveBeenCalled();
   expect(transaction).not.toHaveBeenCalled();
  } finally {
   await rm(root,{recursive:true,force:true});
  }
 });
 it('does not let another account upload a part into someone else\'s upload',async()=>{
  query.mockResolvedValueOnce({rowCount:0,rows:[]});
  const put=jest.spyOn(service['storage'],'put');
  const bytes=Buffer.from('private-part');
  const checksum=createHash('sha256').update(bytes).digest('hex');
  await expect(service.receiveUploadPart('attacker','123e4567-e89b-42d3-a456-426614174000',0,bytes,checksum))
   .rejects.toBeInstanceOf(NotFoundException);
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
 });
 it('rejects an upload part with an invalid checksum before database or storage writes',async()=>{
  const put=jest.spyOn(service['storage'],'put');
  const bytes=Buffer.from('part-data');
  await expect(service.receiveUploadPart('owner','123e4567-e89b-42d3-a456-426614174000',0,bytes,'0'.repeat(64)))
   .rejects.toBeInstanceOf(BadRequestException);
  expect(query).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  put.mockRestore();
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
 it('streams a staged upload, verifies checksum and quarantines the asset',async()=>{
  const root=await mkdtemp(join(tmpdir(),'momentia-media-stream-'));
  const previous=process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR=root;
  const bytes=Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00]);
  const uploadId='123e4567-e89b-42d3-a456-426614174000';
  const staged=join(root,'incoming.bin');
  await writeFile(staged,bytes);
  query.mockResolvedValueOnce({rowCount:1,rows:[{
   id:uploadId,state:'created',uploader_id:'u',media_asset_id:'asset-stream',
   size_bytes:bytes.length,checksum_sha256:createHash('sha256').update(bytes).digest('hex'),
   storage_key_original:'pending/u/asset-stream',declared_mime_type:'image/jpeg',storage_provider:'local',
  }]});
  query.mockResolvedValueOnce({rowCount:1,rows:[{id:uploadId,state:'uploaded',media_asset_id:'asset-stream',asset_status:'quarantined'}]});
  transaction.mockImplementation(async(operation:(client:unknown)=>Promise<unknown>)=>
   operation({query:jest.fn().mockResolvedValue({rowCount:1,rows:[]})}));
  try {
   const uploadService=new MediaService({query,transaction} as unknown as DatabaseService,new LocalMediaStorage());
   const result=await uploadService.receiveUploadFile('u',uploadId,staged,bytes.length);
   expect(await readFile(join(root,'pending/u/asset-stream'))).toEqual(bytes);
   expect(result).toMatchObject({state:'uploaded',asset_status:'quarantined'});
  } finally {
   if(previous===undefined) delete process.env.MEDIA_STORAGE_DIR;
   else process.env.MEDIA_STORAGE_DIR=previous;
   await rm(root,{recursive:true,force:true});
  }
 });
 it('rejects staged upload checksum mismatch before writing to media storage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'momentia-media-stream-invalid-'));
  const previous=process.env.MEDIA_STORAGE_DIR;
  process.env.MEDIA_STORAGE_DIR=root;
  const bytes=Buffer.from([0xff,0xd8,0xff,0xdb,0x00,0x43,0x00]);
  const uploadId='123e4567-e89b-42d3-a456-426614174000';
  const staged=join(root,'incoming.bin');
  await writeFile(staged,bytes);
  query.mockResolvedValueOnce({rowCount:1,rows:[{
   id:uploadId,state:'created',uploader_id:'u',media_asset_id:'asset-stream-invalid',
   size_bytes:bytes.length,checksum_sha256:'0'.repeat(64),
   storage_key_original:'pending/u/asset-stream-invalid',declared_mime_type:'image/jpeg',storage_provider:'local',
  }]});
  const storage=new LocalMediaStorage();
  const putFile=jest.spyOn(storage,'putFile');
  try {
   const uploadService=new MediaService({query,transaction} as unknown as DatabaseService,storage);
   await expect(uploadService.receiveUploadFile('u',uploadId,staged,bytes.length)).rejects.toThrow('SHA-256 checksum mismatch.');
   expect(putFile).not.toHaveBeenCalled();
   expect(transaction).not.toHaveBeenCalled();
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
  expect(query.mock.calls[0][0]).toContain("media_viewer.status='active'");
  expect(query.mock.calls[0][0]).toContain("post_author.status='active'");
  expect(query.mock.calls[0][0]).toContain("album_adder.status='active'");
  expect(query.mock.calls[0][0]).toContain('b.blocked_id=i.added_by');
  expect(query.mock.calls[0][0]).toContain("timeline_post.audience='space'");
  expect(query.mock.calls[0][0]).toContain("timeline_post.status='published'");
  expect(query.mock.calls[0][0]).toContain("album_space.status IN ('active','archived')");
 });

});
