import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect,
  OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
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
export class AudioGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(AudioGateway.name);

  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly identities: OidcIdentityService,
    private readonly audio: AudioService,
  ) {}

  afterInit() {
    this.logger.log('Social Audio realtime gateway initialized.');
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
