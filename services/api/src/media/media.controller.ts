import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Put, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'fs';
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
  const file=await this.media.getAssetContent(req.userId!,id,'original');
  response.setHeader('Cache-Control','private, max-age=60');
  response.setHeader('X-Content-Type-Options','nosniff');
  return new StreamableFile(createReadStream(file.path),{
   type:file.mimeType,
   disposition:`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
   length:file.sizeBytes,
  });
 }
 @Get('assets/:assetId/variants/:variantType/content')
 async getAssetVariant(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string,@Param('variantType') variantType:string,@Res({passthrough:true}) response:Response) {
  const file=await this.media.getAssetContent(req.userId!,id,variantType);
  response.setHeader('Cache-Control','private, max-age=300');
  response.setHeader('X-Content-Type-Options','nosniff');
  return new StreamableFile(createReadStream(file.path),{
   type:file.mimeType,
   disposition:`inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
   length:file.sizeBytes,
  });
 }
 @Delete('assets/:assetId')
 deleteAsset(@Req() req:Request&AuthenticatedRequest,@Param('assetId') id:string){return this.media.deleteAsset(req.userId!,id);}
}
