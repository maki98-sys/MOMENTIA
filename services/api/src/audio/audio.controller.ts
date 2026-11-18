import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { AudioService } from './audio.service';
import { AudioGateway } from './audio.gateway';

@Controller()
@UseGuards(OidcBearerGuard)
export class AudioController {
  constructor(private readonly audio: AudioService, private readonly gateway: AudioGateway) {}

  private async publish<T>(userId: string, sessionId: string, event: string, operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    await this.gateway.publishSession(userId, sessionId, event);
    return result;
  }

  @Post('spaces/:spaceId/audio-sessions')
  create(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string, @Body() body: { sourceProvider?: unknown }) {
    return this.audio.createSession(req.userId!, spaceId, body?.sourceProvider);
  }

  @Get('spaces/:spaceId/audio-sessions/active')
  active(@Req() req: Request & AuthenticatedRequest, @Param('spaceId') spaceId: string) {
    return this.audio.getActiveSession(req.userId!, spaceId);
  }

  @Get('audio-sessions/:sessionId')
  get(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.audio.getSession(req.userId!, sessionId);
  }

  @Post('audio-sessions/:sessionId/join')
  join(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.publish(req.userId!, sessionId, 'audio:participant:joined', () => this.audio.join(req.userId!, sessionId));
  }

  @Post('audio-sessions/:sessionId/heartbeat')
  heartbeat(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.audio.heartbeat(req.userId!, sessionId);
  }

  @Post('audio-sessions/:sessionId/leave')
  leave(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.publish(req.userId!, sessionId, 'audio:participant:left', () => this.audio.leave(req.userId!, sessionId));
  }

  @Post('audio-sessions/:sessionId/queue')
  addQueueItem(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string, @Body() body: { trackReference?: unknown }) {
    return this.publish(req.userId!, sessionId, 'audio:queue:updated', () => this.audio.addQueueItem(req.userId!, sessionId, body?.trackReference));
  }

  @Delete('audio-sessions/:sessionId/queue/:itemId')
  removeQueueItem(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string, @Param('itemId') itemId: string) {
    return this.publish(req.userId!, sessionId, 'audio:queue:updated', () => this.audio.removeQueueItem(req.userId!, sessionId, itemId));
  }

  @Patch('audio-sessions/:sessionId/playback')
  playback(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string, @Body() body: { action?: unknown; positionMs?: unknown; currentItemId?: unknown; expectedVersion?: unknown }) {
    return this.publish(req.userId!, sessionId, 'audio:playback:updated', () => this.audio.updatePlayback(req.userId!, sessionId, body));
  }

  @Post('audio-sessions/:sessionId/queue/:itemId/vote')
  vote(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string, @Param('itemId') itemId: string, @Body() body: { vote?: unknown }) {
    return this.publish(req.userId!, sessionId, 'audio:queue:vote-updated', () => this.audio.vote(req.userId!, sessionId, itemId, body?.vote));
  }
}
