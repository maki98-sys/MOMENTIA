import {
  BadRequestException, Controller, Get, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { ConnectionsService } from './connections.service';

@Controller('me')
@UseGuards(OidcBearerGuard)
export class ConnectionsSelfController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get('following')
  async following(
    @Req() request: Request & AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.list(request, 'following', cursor, limit);
  }

  @Get('followers')
  async followers(
    @Req() request: Request & AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.list(request, 'followers', cursor, limit);
  }

  @Get('follow-requests')
  async requests(
    @Req() request: Request & AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.list(request, 'requests', cursor, limit);
  }

  private async list(
    request: AuthenticatedRequest,
    kind: 'following' | 'followers' | 'requests',
    cursor?: string,
    limit?: string,
  ) {
    if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
    if (cursor !== undefined && cursor.length > 512) throw new BadRequestException('cursor is too long.');
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50.');
    }
    return this.connections.list(request.userId, kind, cursor, parsedLimit);
  }
}
