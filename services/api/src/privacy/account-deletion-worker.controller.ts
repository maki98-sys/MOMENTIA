import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrivacyService } from './privacy.service';

@Controller('internal/deletions')
export class AccountDeletionWorkerController {
  constructor(private readonly privacy: PrivacyService) {}

  private authorize(token?: string) {
    const expected = process.env.NOTIFICATION_WORKER_TOKEN ?? '';
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
  }

  @Post('claim')
  claim(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    const value = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    if (typeof value.workerId !== 'string') throw new UnauthorizedException('workerId is required.');
    return this.privacy.claimDueDeletionRequests(value.workerId, Number(value.limit) || 10);
  }

  @Post(':requestId/complete')
  complete(
    @Headers('x-worker-token') token: string | undefined,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    const value = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown> : {};
    if (typeof value.workerId !== 'string') throw new UnauthorizedException('workerId is required.');
    const { workerId, ...result } = value;
    return this.privacy.completeDeletionRequest(workerId, requestId, result);
  }
}
