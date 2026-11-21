import { Body, Controller, Headers, UnauthorizedException } from '@nestjs/common';
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

  @Body()
  cleanupBodyPlaceholder() {}
}
