import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { AudioService } from './audio.service';

@Controller('internal/audio')
export class AudioWorkerController {
  constructor(private readonly audio: AudioService) {}

  private authorize(provided: string | undefined): void {
    const expected = process.env.AUDIO_WORKER_TOKEN;
    if (!expected || !provided) throw new UnauthorizedException('Invalid worker credentials.');
    const supplied = Buffer.from(provided);
    const configured = Buffer.from(expected);
    if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
      throw new UnauthorizedException('Invalid worker credentials.');
    }
  }

  @Post('cleanup-stale-participants')
  cleanup(
    @Headers('x-worker-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    this.authorize(token);
    const value = body === undefined ? {} : body;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UnauthorizedException('Invalid audio cleanup payload.');
    }
    const fields = value as Record<string, unknown>;
    if (Object.keys(fields).some(key => key !== 'staleAfterSeconds')) {
      throw new UnauthorizedException('Unsupported audio cleanup fields.');
    }
    const timeout = fields.staleAfterSeconds === undefined ? 45 : Number(fields.staleAfterSeconds);
    if (!Number.isSafeInteger(timeout) || timeout < 15 || timeout > 3600) {
      throw new UnauthorizedException('staleAfterSeconds must be between 15 and 3600.');
    }
    return this.audio.cleanupStaleParticipants(timeout).then(sessionIds => ({
      processedAt: new Date().toISOString(),
      staleAfterSeconds: timeout,
      affectedSessionIds: sessionIds,
      affectedCount: sessionIds.length,
    }));
  }
}
