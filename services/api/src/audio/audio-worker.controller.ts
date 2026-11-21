import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { AudioService } from './audio.service';

@Controller('internal/audio')
export class AudioWorkerController {
  constructor(private readonly audio: AudioService) {}

  private authorize(provided: string | undefined): void {
    const expected = process.env.NOTIFICATION_WORKER_TOKEN;
    if (!expected || !provided) throw new UnauthorizedException('Invalid worker credentials.');
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !timingSafeEqual(left, right)) {
      throw new UnauthorizedException('Invalid worker credentials.');
    }
  }

  @Post('cleanup-stale-participants')
  cleanup(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: { staleAfterSeconds?: unknown },
  ) {
    this.authorize(token);
    const timeout = body?.staleAfterSeconds === undefined ? 45 : Number(body.staleAfterSeconds);
    return this.audio.cleanupStaleParticipants(timeout).then(sessionIds => ({
      processedAt: new Date().toISOString(),
      staleAfterSeconds: timeout,
      affectedSessionIds: sessionIds,
      affectedCount: sessionIds.length,
    }));
  }
}
