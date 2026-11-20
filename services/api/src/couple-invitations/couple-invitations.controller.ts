import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { CoupleInvitationsService } from './couple-invitations.service';

@Controller('couple-invitations')
@UseGuards(OidcBearerGuard)
export class CoupleInvitationsController {
  constructor(private readonly invitations:CoupleInvitationsService) {}
  @Post()
  create(@Req() req:Request&AuthenticatedRequest,@Body() body:unknown) {
    return this.invitations.create(req.userId!,this.invitations.validateCreateInput(body));
  }
  @Get()
  list(@Req() req:Request&AuthenticatedRequest) {
    return this.invitations.list(req.userId!);
  }
  @Delete(':invitationId')
  revoke(@Req() req:Request&AuthenticatedRequest,@Param('invitationId') id:string) {
    return this.invitations.revoke(req.userId!,id);
  }
  @Post('accept')
  accept(@Req() req:Request&AuthenticatedRequest,@Body() body:unknown) {
    const token=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).token:undefined;
    return this.invitations.accept(req.userId!,typeof token==='string'?token:'');
  }
}
