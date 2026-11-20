import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { ModerationService } from './moderation.service';

@Controller()
@UseGuards(OidcBearerGuard)
export class ModerationController {
  constructor(private readonly moderation:ModerationService) {}
  @Post('me/reports')
  submit(@Req() req:Request&AuthenticatedRequest,@Body() body:unknown) { return this.moderation.submit(req.userId!,body); }
  @Get('me/reports')
  listMine(@Req() req:Request&AuthenticatedRequest,@Query('limit') limit?:string) { return this.moderation.listMine(req.userId!,Number(limit)||30); }
  @Get('moderation/reports')
  queue(@Req() req:Request&AuthenticatedRequest,@Query('status') status?:string,@Query('limit') limit?:string) { return this.moderation.queue(req.userId!,status??'open',Number(limit)||50); }
  @Post('moderation/reports/:reportId/review')
  review(@Req() req:Request&AuthenticatedRequest,@Param('reportId') id:string,@Body() body:unknown) { return this.moderation.review(req.userId!,id,body); }
}
