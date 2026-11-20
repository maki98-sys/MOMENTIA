import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ProfileService } from './profile.service';

@Controller('users')
@UseGuards(OidcBearerGuard)
export class PublicProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get(':userId/profile')
  getProfile(
    @Req() request: Request & AuthenticatedRequest,
    @Param('userId') userId: string,
  ) {
    return this.profiles.getPublicProfile(request.userId!, userId);
  }
}
