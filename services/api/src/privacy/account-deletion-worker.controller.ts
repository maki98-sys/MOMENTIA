import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrivacyService } from './privacy.service';

@Controller('internal/deletions')
export class AccountDeletionWorkerController {
  constructor(private readonly privacy: PrivacyService) {}

  private authorize(token?: string) {
    const expected = process.env.ACCOUNT_DELETION_WORKER_TOKEN ?? '';
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UnauthorizedException('Invalid worker payload.');
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some(key => !['workerId','limit'].includes(key)) ||
        typeof value.workerId !== 'string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(value.workerId)) {
      throw new UnauthorizedException('workerId is required.');
    }
    const limit = value.limit === undefined ? 10 : Number(value.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new UnauthorizedException('limit must be between 1 and 50.');
    return this.privacy.claimDueDeletionRequests(value.workerId, limit);
  }

  @Post(':requestId/complete')
  complete(
    @Headers('x-worker-token') token: string | undefined,
    @Param('requestId') requestId: string,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UnauthorizedException('Invalid worker payload.');
    const value = body as Record<string, unknown>;
    if (typeof value.workerId !== 'string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(value.workerId)) throw new UnauthorizedException('workerId is required.');
    const { workerId, ...result } = value;
    return this.privacy.completeDeletionRequest(workerId, requestId, result);
  }
}
