import { Body, Controller, Get, Headers, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { PrivacyService } from './privacy.service';

@Controller('me')
@UseGuards(OidcBearerGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  private authorizeWorker(token?: string) {
    const expected = process.env.NOTIFICATION_WORKER_TOKEN ?? '';
    if (!expected || !token) throw new UnauthorizedException();
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
  }

  @Post('internal/deletions/claim')
  claimDeletions(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorizeWorker(token);
    const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (typeof value.workerId !== 'string') throw new UnauthorizedException('workerId is required.');
    return this.privacy.claimDueDeletionRequests(value.workerId, Number(value.limit) || 10);
  }

  @Post('internal/deletions/:requestId/complete')
  completeDeletion(@Headers('x-worker-token') token: string | undefined, @Param('requestId') requestId: string, @Body() body: unknown) {
    this.authorizeWorker(token);
    const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (typeof value.workerId !== 'string') throw new UnauthorizedException('workerId is required.');
    const { workerId, ...result } = value;
    return this.privacy.completeDeletionRequest(workerId, requestId, result);
  }


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
