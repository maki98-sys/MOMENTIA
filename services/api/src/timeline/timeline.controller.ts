import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { TimelineService } from './timeline.service';

@Controller('spaces/:spaceId/timeline')
@UseGuards(OidcBearerGuard)
export class TimelineController {
  constructor(private readonly timeline:TimelineService) {}
  @Get()
  list(@Req() req:Request & AuthenticatedRequest,@Param('spaceId') spaceId:string,@Query('cursor') cursor?:string,@Query('limit') limit?:string) {
    return this.timeline.list(req.userId!,spaceId,cursor,Number(limit)||30);
  }
  @Post()
  add(@Req() req:Request & AuthenticatedRequest,@Param('spaceId') spaceId:string,@Body() body:unknown) {
    return this.timeline.add(req.userId!,spaceId,body);
  }
}
