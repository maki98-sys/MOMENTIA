import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { OidcTokenVerifier } from '../auth/oidc-token-verifier.service';
import { OidcIdentityService } from '../auth/oidc-identity.service';
import { AudioService } from './audio.service';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const room = (id: string) => `audio-session:${id}`;

@Injectable()
@WebSocketGateway({
  namespace: '/audio',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean),
    credentials: true,
  },
  transports: ['websocket'],
})
export class AudioGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(AudioGateway.name);
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private redisPublisher?: ReturnType<typeof createClient>;
  private redisSubscriber?: ReturnType<typeof createClient>;

  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly identities: OidcIdentityService,
    private readonly audio: AudioService,
  ) {}

  async afterInit() {
    const redisUrl=process.env.AUDIO_REDIS_URL;
    if(redisUrl) {
      const publisher=createClient({url:redisUrl});
      const subscriber=publisher.duplicate();
      publisher.on('error',error=>this.logger.error('Social Audio Redis publisher error.',error));
      subscriber.on('error',error=>this.logger.error('Social Audio Redis subscriber error.',error));
      try {
        await Promise.all([publisher.connect(),subscriber.connect()]);
        this.server.adapter(createAdapter(publisher,subscriber));
        this.redisPublisher=publisher;
        this.redisSubscriber=subscriber;
        this.logger.log('Social Audio Redis adapter connected; cross-instance broadcasts enabled.');
      } catch(error) {
        this.logger.error('Social Audio Redis adapter could not connect; realtime is running in single-instance mode.',error instanceof Error?error.stack:undefined);
        await Promise.allSettled([publisher.quit(),subscriber.quit()]);
      }
    } else {
      this.logger.warn('AUDIO_REDIS_URL is not configured; realtime broadcasts are limited to this API instance.');
    }
    this.logger.log('Social Audio realtime gateway initialized.');
  }

  onModuleInit() {
    const configured = Number(process.env.AUDIO_PRESENCE_TIMEOUT_SECONDS ?? 45);
    const timeout = Number.isSafeInteger(configured) && configured >= 15 && configured <= 3600 ? configured : 45;
    this.cleanupTimer = setInterval(() => {
      void this.expireStaleParticipants(timeout);
    }, 15_000);
    this.cleanupTimer.unref?.();
  }

  async onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([
      ...(this.redisPublisher?[this.redisPublisher.quit()]:[]),
      ...(this.redisSubscriber?[this.redisSubscriber.quit()]:[]),
    ]);
  }

  private async expireStaleParticipants(timeoutSeconds: number) {
    try {
      const sessionIds = await this.audio.cleanupStaleParticipants(timeoutSeconds);
      for (const sessionId of sessionIds) {
        this.server?.to(room(sessionId)).emit('audio:presence:expired', { sessionId });
      }
    } catch (error) {
      this.logger.error('Could not expire stale Social Audio participants.', error instanceof Error ? error.stack : undefined);
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.accessToken;
      if (typeof token !== 'string' || token.length > 8192 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
        client.disconnect(true);
        return;
      }
      const principal = await this.verifier.verifyAccessToken(token);
      const identity = await this.identities.resolveOrProvision(principal);
      client.data.userId = identity.userId;
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const sessionId = client.data.sessionId;
    if (typeof sessionId === 'string') {
      client.leave(room(sessionId));
    }
  }

  @SubscribeMessage('audio:join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() payload: { sessionId?: unknown }) {
    const userId = client.data.userId;
    const sessionId = payload?.sessionId;
    if (typeof userId !== 'string' || typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
      return { event: 'audio:error', data: { code: 'INVALID_SESSION' } };
    }
    try {
      const snapshot = await this.audio.getSession(userId, sessionId);
      const previous = client.data.sessionId;
      if (typeof previous === 'string' && previous !== sessionId) await client.leave(room(previous));
      await client.join(room(sessionId));
      client.data.sessionId = sessionId;
      client.emit('audio:snapshot', snapshot);
      return { event: 'audio:joined', data: { sessionId, serverVersion: snapshot.server_version } };
    } catch {
      return { event: 'audio:error', data: { code: 'SESSION_ACCESS_DENIED' } };
    }
  }

  @SubscribeMessage('audio:leave')
  async leave(@ConnectedSocket() client: Socket) {
    const sessionId = client.data.sessionId;
    if (typeof sessionId === 'string') await client.leave(room(sessionId));
    delete client.data.sessionId;
    return { event: 'audio:left', data: { sessionId: sessionId ?? null } };
  }

  @SubscribeMessage('audio:heartbeat')
  async heartbeat(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    const sessionId = client.data.sessionId;
    if (typeof userId !== 'string' || typeof sessionId !== 'string') {
      return { event: 'audio:error', data: { code: 'NOT_IN_SESSION' } };
    }
    try {
      const result = await this.audio.heartbeat(userId, sessionId);
      return { event: 'audio:heartbeat:ack', data: result };
    } catch {
      return { event: 'audio:error', data: { code: 'PARTICIPATION_INACTIVE' } };
    }
  }

  async publishSession(userId: string, sessionId: string, event: string) {
    const snapshot = await this.audio.getSession(userId, sessionId);
    this.server.to(room(sessionId)).emit(event, snapshot);
    return snapshot;
  }
}
