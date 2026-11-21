import { Body, Controller, Param, Post, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { InvitationsService } from './invitations.service';

@Controller()
@UseGuards(OidcBearerGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post('spaces/:spaceId/invitations')
  create(@Req() request: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string, @Body() body: unknown) {
    return this.invitations.create(request.userId!, spaceId, this.invitations.validateCreateInput(body));
  }

  @Get('spaces/:spaceId/invitations')
  list(@Req() request: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string) {
    return this.invitations.list(request.userId!, spaceId);
  }

  @Post('spaces/:spaceId/invitations/:invitationId/revoke')
  revoke(@Req() request: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string, @Param('invitationId') invitationId: string) {
    return this.invitations.revoke(request.userId!, spaceId, invitationId);
  }


  @Post('invitations/preview')
  preview(@Body() body: unknown) {
    const token = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).token : undefined;
    if (typeof token !== 'string') return this.invitations.preview('');
    return this.invitations.preview(token);
  }

  @Post('invitations/accept')
  accept(@Req() request: Request & AuthenticatedRequest, @Body() body: unknown) {
    const token = body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).token : undefined;
    if (typeof token !== 'string') return this.invitations.accept(request.userId!, '');
    return this.invitations.accept(request.userId!, token);
  }
}
