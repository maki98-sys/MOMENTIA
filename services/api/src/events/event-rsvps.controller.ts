import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { EventRsvpsService } from './event-rsvps.service';

@Controller('spaces/:spaceId/event/rsvp')
@UseGuards(OidcBearerGuard)
export class EventRsvpsController {
  constructor(private readonly rsvps: EventRsvpsService) {}
  @Post()
  respond(@Req() req: Request & AuthenticatedRequest,@Param('spaceId') id:string,@Body() body:unknown) {
    return this.rsvps.respond(req.userId!,id,body);
  }
  @Get()
  summary(@Req() req: Request & AuthenticatedRequest,@Param('spaceId') id:string) {
    return this.rsvps.summary(req.userId!,id);
  }
  @Delete()
  remove(@Req() req: Request & AuthenticatedRequest,@Param('spaceId') id:string) {
    return this.rsvps.remove(req.userId!,id);
  }
}
