import {
  BadRequestException, Controller, Get, Param, Query, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { TimelineService } from './timeline.service';

@Controller('spaces/:spaceId/timeline')
@UseGuards(OidcBearerGuard)
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Get()
  async list(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    if (!isUuid(spaceId)) throw new BadRequestException('spaceId must be a valid UUID.');
    if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
    if (cursor !== undefined && cursor.length > 512) {
      throw new BadRequestException('cursor is too long.');
    }
    const parsedLimit = limit === undefined ? 20 : Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
      throw new BadRequestException('limit must be an integer between 1 and 50.');
    }
    return this.timeline.list(request.userId, spaceId, cursor, parsedLimit);
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
