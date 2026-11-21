import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { SpacesService } from './spaces.service';

@Controller('internal/events')
export class EventsWorkerController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly config: ConfigService,
  ) {}

  @Post('archive-ended')
  archiveEnded(@Headers('x-worker-token') token?: string) {
    const expected = this.config.get<string>('NOTIFICATION_WORKER_TOKEN');
    if (!expected || !token) throw new UnauthorizedException();
    const supplied = Buffer.from(token);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException();
    }
    return this.spaces.archiveEndedEvents(24);
  }
}
