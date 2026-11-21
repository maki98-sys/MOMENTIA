import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { SessionTokenService } from './session-token.service';

@Controller('internal/auth/sessions')
export class SessionRetentionWorkerController {
  constructor(
    private readonly sessions: SessionTokenService,
    private readonly config: ConfigService,
  ) {}

  private authorize(token?: string) {
    const expected = this.config.get<string>('AUTH_SESSION_WORKER_TOKEN') ?? '';
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
  }

  @Post('cleanup')
  cleanup(@Headers('x-worker-token') token: string | undefined, @Body() body: unknown) {
    this.authorize(token);
    const value = body === undefined ? {} : body;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnauthorizedException('Invalid cleanup payload.');
    }
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== 'limit')) {
      throw new UnauthorizedException('Unsupported cleanup fields.');
    }
    const limit = fields.limit === undefined ? 100 : Number(fields.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new UnauthorizedException('limit must be between 1 and 500.');
    }
    return this.sessions.cleanupExpiredSessions(limit);
  }
}
