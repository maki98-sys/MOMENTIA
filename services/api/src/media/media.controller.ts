import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MediaService } from './media.service';

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

async function readUploadBody(request: Request): Promise<Buffer> {
 const chunks: Buffer[] = [];
 let total = 0;
 for await (const chunk of request) {
  const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  total += part.length;
  if (total > MAX_UPLOAD_BYTES) throw new BadRequestException('File exceeds the 200 MB platform upload limit.');
  chunks.push(part);
 }
 if (!total) throw new BadRequestException('Upload body is empty.');
 return Buffer.concat(chunks, total);
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
  const body = await readUploadBody(req);
  return this.media.receiveUpload(req.userId!,id,body);
 }
 @Put('uploads/:uploadId/parts/:partNumber')
 async uploadPart(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string,@Param('partNumber') part:string,@Headers('content-type') contentType?:string,@Headers('x-part-sha256') checksum?:string) {
  if(!contentType||!contentType.startsWith('application/octet-stream')) throw new BadRequestException('Content-Type must be application/octet-stream.');
  const partNumber=Number(part);
  if(!Number.isInteger(partNumber)||partNumber<0||partNumber>10000) throw new BadRequestException('Invalid part number.');
  const chunks:Buffer[]=[];let total=0;
  for await(const chunk of req) {
   const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);total+=buffer.length;
   if(total>8*1024*1024) throw new BadRequestException('Upload part exceeds 8 MB.');
   chunks.push(buffer);
  }
  if(!total) throw new BadRequestException('Upload part is empty.');
  return this.media.receiveUploadPart(req.userId!,id,partNumber,Buffer.concat(chunks,total),checksum??'');
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
  response.setHeader('Cache-Control','private, max-age=60');
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
  response.setHeader('Cache-Control','private, max-age=300');
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
