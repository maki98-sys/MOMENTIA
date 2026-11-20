import { Controller,Delete,Get,Param,Post,Req,UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { JoinRequestsService } from './join-requests.service';

@Controller('spaces/:spaceId/join-requests')
@UseGuards(OidcBearerGuard)
export class JoinRequestsController {
 constructor(private readonly requests:JoinRequestsService){}
 @Post()
 create(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string){
  return this.requests.create(req.userId!,spaceId);
 }
 @Get()
 list(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string){
  return this.requests.list(req.userId!,spaceId);
 }
 @Post(':requestId/approve')
 approve(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('requestId') requestId:string){
  return this.requests.review(req.userId!,spaceId,requestId,'approved');
 }
 @Post(':requestId/reject')
 reject(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('requestId') requestId:string){
  return this.requests.review(req.userId!,spaceId,requestId,'rejected');
 }
 @Delete(':requestId')
 cancel(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('requestId') requestId:string){
  return this.requests.cancel(req.userId!,spaceId,requestId);
 }
}
