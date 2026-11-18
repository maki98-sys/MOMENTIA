import { UnauthorizedException, Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { ProfileVisibility } from './profile.types';
import { ProfilesService } from './profiles.service';
import type { UpdateProfileInput } from './profile.types';

@Controller('me/profile')
@UseGuards(OidcBearerGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  async findMine(@Req() request: Request & AuthenticatedRequest) {
    return { profile: await this.profiles.findMine(requireUserId(request)) };
  }

  @Put()
  async updateMine(
    @Req() request: Request & AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return {
      profile: await this.profiles.updateMine(requireUserId(request), parseUpdateProfile(body)),
    };
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
}

function parseUpdateProfile(value: unknown): UpdateProfileInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }

  const body = value as Record<string, unknown>;
  const allowed = new Set(['displayName', 'bio', 'visibility']);
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw new BadRequestException(`Unexpected profile fields: ${unexpected.join(', ')}.`);
  }

  if (typeof body.displayName !== 'string') {
    throw new BadRequestException('displayName is required and must be a string.');
  }
  const displayName = body.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new BadRequestException('displayName must contain between 1 and 80 characters.');
  }

  let bio: string | null = null;
  if (body.bio !== undefined && body.bio !== null) {
    if (typeof body.bio !== 'string' || body.bio.length > 500) {
      throw new BadRequestException('bio must be a string of at most 500 characters or null.');
    }
    bio = body.bio.trim() || null;
  }

  const visibility = body.visibility ?? 'private';
  if (visibility !== 'public' && visibility !== 'followers' && visibility !== 'private') {
    throw new BadRequestException('visibility must be public, followers or private.');
  }

  return { displayName, bio, visibility: visibility as ProfileVisibility };
}
