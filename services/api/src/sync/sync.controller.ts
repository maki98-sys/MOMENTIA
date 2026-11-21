import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SyncService } from './sync.service';

@Controller('sync')
@UseGuards(OidcBearerGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  push(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    return this.sync.push(req.userId!, body);
  }

  @Post('checkpoint')
  checkpoint(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    return this.sync.saveCheckpoint(req.userId!, body);
  }

  @Get('pull')
  pull(
    @Req() req: Request & AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.sync.pull(req.userId!, cursor, Number(limit) || 200);
  }
}
