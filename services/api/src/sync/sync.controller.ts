import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SyncService } from './sync.service';
import { validateSyncPushEnvelope } from './sync-payload.validator';

@Controller('sync')
@UseGuards(OidcBearerGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('push')
  push(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    validateSyncPushEnvelope(body);
    return this.sync.push(req.userId!, body);
  }

  @Post('snapshot')
  snapshot(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    return this.sync.snapshot(req.userId!, body);
  }

  @Delete('snapshot/:snapshotId')
  releaseSnapshot(
    @Req() req: Request & AuthenticatedRequest,
    @Param('snapshotId') snapshotId: string,
  ) {
    return this.sync.releaseSnapshot(req.userId!, snapshotId);
  }

  @Get('status')
  status(
    @Req() req: Request & AuthenticatedRequest,
    @Query('deviceId') deviceId?: string,
  ) {
    if (!deviceId) throw new BadRequestException('deviceId is required.');
    return this.sync.getDeviceSyncStatus(req.userId!, deviceId);
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
    if (limit !== undefined && !/^\\d{1,4}$/.test(limit)) {
      throw new BadRequestException('limit must be a positive integer.');
    }
    const parsedLimit = limit === undefined ? 200 : Number(limit);
    if (!Number.isSafeInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
      throw new BadRequestException('limit must be between 1 and 500.');
    }
    return this.sync.pull(req.userId!, cursor, parsedLimit);
  }
}
