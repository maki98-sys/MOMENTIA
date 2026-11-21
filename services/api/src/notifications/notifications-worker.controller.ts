import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
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
  dispatch(@Headers('x-worker-token') token?: string) {
    const expected = this.config.get<string>('NOTIFICATION_WORKER_TOKEN');
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    return this.notifications.dispatchPushBatch(50);
  }

  @Post('recover-stale')
  recoverStale(@Headers('x-worker-token') token?: string) {
    const expected = this.config.get<string>('NOTIFICATION_WORKER_TOKEN');
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    return this.notifications.recoverStalePushDeliveries(180);
  }

}
