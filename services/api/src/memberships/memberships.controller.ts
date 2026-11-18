import { Controller, Get, Param, Patch, Delete, Post, Body, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MembershipsService } from './memberships.service';

@Controller('spaces/:spaceId/members')
@UseGuards(OidcBearerGuard)
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get()
  list(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string) {
    return this.memberships.list(req.userId!, spaceId);
  }

  @Patch(':userId/role')
  changeRole(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string,
    @Param('userId') targetId: string, @Body() body: { role?: unknown }) {
    return this.memberships.changeRole(req.userId!, spaceId, targetId, body?.role);
  }

  @Delete(':userId')
  remove(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string, @Param('userId') targetId: string) {
    return this.memberships.remove(req.userId!, spaceId, targetId);
  }

  @Post('leave')
  leave(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string) {
    return this.memberships.leave(req.userId!, spaceId);
  }
}
