import { Body, Controller, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MediaService } from './media.service';
@Controller('media')
@UseGuards(OidcBearerGuard)
export class MediaController {
 constructor(private readonly media:MediaService){}
 @Post('uploads')
 create(@Req() req:Request&AuthenticatedRequest,@Body() body:unknown,@Headers('idempotency-key') key?:string){return this.media.createUpload(req.userId!,body,key??'');}
 @Get('uploads')
 list(@Req() req:Request&AuthenticatedRequest,@Query('limit') limit?:string){return this.media.listMine(req.userId!,Number(limit)||30);}
 @Get('uploads/:uploadId')
 get(@Req() req:Request&AuthenticatedRequest,@Param('uploadId') id:string){return this.media.getUpload(req.userId!,id);}
}
