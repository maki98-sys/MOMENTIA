import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ProfileService } from './profile.service';

@Controller('me')
@UseGuards(OidcBearerGuard)
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  getMe(@Req() request: Request & AuthenticatedRequest) {
    return this.profiles.getMe(request.userId!);
  }

  @Patch('profile')
  updateProfile(
    @Req() request: Request & AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const input = this.profiles.validateProfileInput(body);
    return this.profiles.updateMyProfile(request.userId!, input);
  }
}
