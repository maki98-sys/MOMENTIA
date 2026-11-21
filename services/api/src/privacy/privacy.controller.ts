import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { PrivacyService } from './privacy.service';

@Controller('me')
@UseGuards(OidcBearerGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}



  @Get('data-export')
  exportMyData(@Req() request: Request & AuthenticatedRequest) {
    return this.privacy.exportMyData(request.userId!);
  }

  @Post('account-deletion')
  requestDeletion(@Req() request: Request & AuthenticatedRequest) {
    return this.privacy.requestDeletion(request.userId!);
  }

  @Get('account-deletion')
  deletionStatus(@Req() request: Request & AuthenticatedRequest) {
    return this.privacy.getDeletionStatus(request.userId!);
  }

  @Post('account-deletion/cancel')
  cancelDeletion(@Req() request: Request & AuthenticatedRequest) {
    return this.privacy.cancelDeletion(request.userId!);
  }
}
