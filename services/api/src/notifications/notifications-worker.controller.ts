import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { NotificationsService } from './notifications.service';

@Controller('internal/notifications/push')
export class NotificationsWorkerController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  @Post('dispatch')
  dispatch(@Headers('x-worker-token') token?: string, @Body() body?: unknown) {
    const expected = this.config.get<string>('NOTIFICATION_WORKER_TOKEN');
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    const value = body === undefined ? {} : body;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnauthorizedException('Invalid dispatch payload.');
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== 'limit')) throw new UnauthorizedException('Unsupported dispatch fields.');
    const limit = fields.limit === undefined ? 50 : Number(fields.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new UnauthorizedException('limit must be between 1 and 100.');
    return this.notifications.dispatchPushBatch(limit);
  }

  @Post('recover-stale')
  recoverStale(@Headers('x-worker-token') token?: string, @Body() body?: unknown) {
    const expected = this.config.get<string>('NOTIFICATION_WORKER_TOKEN');
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    const value = body === undefined ? {} : body;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnauthorizedException('Invalid recovery payload.');
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== 'staleAfterSeconds')) throw new UnauthorizedException('Unsupported recovery fields.');
    const staleAfterSeconds = fields.staleAfterSeconds === undefined ? 180 : Number(fields.staleAfterSeconds);
    if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < 60 || staleAfterSeconds > 3600) throw new UnauthorizedException('staleAfterSeconds must be between 60 and 3600.');
    return this.notifications.recoverStalePushDeliveries(staleAfterSeconds);
  }

}
