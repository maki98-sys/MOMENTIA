import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, PayloadTooLargeException, Post, HttpException, HttpStatus, Put, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MediaService } from './media.service';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_UPLOAD_PART_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT_UPLOAD_STAGING = Math.min(Math.max(Number(process.env.MEDIA_UPLOAD_STAGING_MAX_CONCURRENT) || 4, 1), 32);
let activeUploadStaging = 0;

async function stageUploadBody(request: Request, maxBytes = MAX_UPLOAD_BYTES): Promise<{ directory: string; filePath: string; sizeBytes: number; release: () => void }> {
 if (activeUploadStaging >= MAX_CONCURRENT_UPLOAD_STAGING) {
  request.resume();
  throw new HttpException('Upload staging is at capacity. Retry shortly.', HttpStatus.TOO_MANY_REQUESTS);
 }
 activeUploadStaging++;
 let released = false;
 const release = () => {
  if (!released) {
   released = true;
   activeUploadStaging = Math.max(0, activeUploadStaging - 1);
  }
 };
 let directory: string;
 try {
  directory = await mkdtemp(join(tmpdir(), 'momentia-upload-'));
 } catch (error) {
  release();
  throw error;
 }
 const filePath = join(directory, 'request-body.bin');
 let total = 0;
 const limiter = new Transform({
  transform(chunk: Buffer | string, _encoding, callback) {
   const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
   total += part.length;
   if (total > maxBytes) {
    callback(new PayloadTooLargeException(maxBytes === MAX_UPLOAD_PART_BYTES ? 'Upload part exceeds 8 MB.' : 'File exceeds the 200 MB platform upload limit.'));
    return;
   }
   callback(null, part);
  },
 });
 try {
  await pipeline(request, limiter, createWriteStream(filePath, { flags: 'wx', mode: 0o600 }));
  if (!total) throw new BadRequestException('Upload body is empty.');
  return { directory, filePath, sizeBytes: total, release };
 } catch (error) {
  await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  release();
  throw error;
 }
}

@Controller('media')
@UseGuards(OidcBearerGuard)
export class MediaController {
 constructor(private readonly media:MediaService){}
 @Post('uploads')
 create(@Req() req:Request&AuthenticatedRequest,@Body() body:unknown,@Headers('idempotency-key') key?:string){return this.media.createUpload(req.userId!,body,key??'');}
 @Put('uploads/:uploadId/content')
 async uploadContent(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string,@Headers('content-type') contentType?:string) {
  if (!contentType || !contentType.startsWith('application/octet-stream')) throw new BadRequestException('Content-Type must be application/octet-stream.');
  try { await this.media.assertUploadOwner(req.userId!,id); } catch (error) { req.resume(); throw error; }
  const staged = await stageUploadBody(req);
  try {
   return await this.media.receiveUploadFile(req.userId!,id,staged.filePath,staged.sizeBytes);
  } finally {
   await rm(staged.directory,{recursive:true,force:true}).catch(()=>undefined);
   staged.release();
  }
 }
 @Put('uploads/:uploadId/parts/:partNumber')
 async uploadPart(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string,@Param('partNumber') part:string,@Headers('content-type') contentType?:string,@Headers('x-part-sha256') checksum?:string) {
  if(!contentType||!contentType.startsWith('application/octet-stream')) throw new BadRequestException('Content-Type must be application/octet-stream.');
  const partNumber=Number(part);
  if(!Number.isInteger(partNumber)||partNumber<0||partNumber>10000) throw new BadRequestException('Invalid part number.');
  try { await this.media.assertUploadOwner(req.userId!,id); } catch (error) { req.resume(); throw error; }
  const staged=await stageUploadBody(req,MAX_UPLOAD_PART_BYTES);
  try {
   return await this.media.receiveUploadPartFile(req.userId!,id,partNumber,staged.filePath,staged.sizeBytes,checksum??'');
  } finally {
   await rm(staged.directory,{recursive:true,force:true}).catch(()=>undefined);
  }
 }
 @Post('uploads/:uploadId/complete')
 completeResumable(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string) {
  return this.media.completeResumableUpload(req.userId!,id);
 }
 @Get('uploads')
 list(@Req() req:Request&AuthenticatedRequest,@Query('limit') limit?:string){return this.media.listMine(req.userId!,Number(limit)||30);}
 @Delete('uploads/:uploadId')
 cancelUpload(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string){return this.media.cancelUpload(req.userId!,id);}
 @Get('uploads/:uploadId')
 get(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string){return this.media.getUpload(req.userId!,id);}
 @Get('assets/:assetId')
 getAsset(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string){return this.media.getAsset(req.userId!,id);}
 @Get('assets/:assetId/content')
 async getAssetContent(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string,@Res({passthrough:true}) response:Response) {
  const file=await this.media.openAssetContent(req.userId!,id,'original');
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  return new StreamableFile(file.stream,{
   type:file.mimeType,
   disposition:`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
   length:file.sizeBytes,
  });
 }
 @Get('assets/:assetId/variants/:variantType/content')
 async getAssetVariant(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string,@Param('variantType') variantType:string,@Res({passthrough:true}) response:Response) {
  const file=await this.media.openAssetContent(req.userId!,id,variantType);
  response.setHeader('Cache-Control','private, no-store, max-age=0');
  response.setHeader('X-Content-Type-Options','nosniff');
  return new StreamableFile(file.stream,{
   type:file.mimeType,
   disposition:`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
   length:file.sizeBytes,
  });
 }
 @Delete('assets/:assetId')
 deleteAsset(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string){return this.media.deleteAsset(req.userId!,id);}
}
