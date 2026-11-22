jest.mock('../auth/oidc-token-verifier.service', () => ({ OidcTokenVerifier: class OidcTokenVerifier {} }));
jest.mock('../auth/oidc-identity.service', () => ({ OidcIdentityService: class OidcIdentityService {} }));
jest.mock('redis', () => ({ createClient: jest.fn() }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn(() => ({})) }));

import { AudioGateway } from './audio.gateway';
import { OidcTokenVerifier } from '../auth/oidc-token-verifier.service';
import { OidcIdentityService } from '../auth/oidc-identity.service';
import { AudioService } from './audio.service';
import { createClient } from 'redis';

describe('AudioGateway', () => {
  const verifier = { verifyAccessToken: jest.fn() } as unknown as OidcTokenVerifier;
  const identities = { resolveOrProvision: jest.fn() } as unknown as OidcIdentityService;
  const audio = { getSession: jest.fn(), join: jest.fn(), leave: jest.fn(), heartbeat: jest.fn() } as unknown as AudioService;
  let gateway: AudioGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new AudioGateway(verifier, identities, audio);
  });

  it('fails production startup when the cross-instance Redis adapter is not configured', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedisUrl = process.env.AUDIO_REDIS_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.AUDIO_REDIS_URL;
    try {
      await expect(gateway.afterInit()).rejects.toThrow('AUDIO_REDIS_URL_REQUIRED_IN_PRODUCTION');
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRedisUrl === undefined) delete process.env.AUDIO_REDIS_URL;
      else process.env.AUDIO_REDIS_URL = previousRedisUrl;
    }
  });

  it('fails production startup and closes both Redis clients when a connection fails', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedisUrl = process.env.AUDIO_REDIS_URL;
    const subscriber = {
      on: jest.fn(),
      connect: jest.fn().mockRejectedValue(new Error('redis unavailable')),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const publisher = {
      on: jest.fn(),
      duplicate: jest.fn().mockReturnValue(subscriber),
      connect: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    (createClient as jest.Mock).mockReturnValueOnce(publisher);
    process.env.NODE_ENV = 'production';
    process.env.AUDIO_REDIS_URL = 'redis://localhost:6379';
    try {
      await expect(gateway.afterInit()).rejects.toThrow('AUDIO_REDIS_CONNECTION_REQUIRED_IN_PRODUCTION');
      expect(publisher.connect).toHaveBeenCalledTimes(1);
      expect(subscriber.connect).toHaveBeenCalledTimes(1);
      expect(publisher.quit).toHaveBeenCalledTimes(1);
      expect(subscriber.quit).toHaveBeenCalledTimes(1);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousRedisUrl === undefined) delete process.env.AUDIO_REDIS_URL;
      else process.env.AUDIO_REDIS_URL = previousRedisUrl;
    }
  });

  it('disconnects a socket without a handshake access token', async () => {
    const socket = { handshake: { auth: {} }, disconnect: jest.fn(), data: {} } as any;
    await gateway.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('verifies OIDC and stores the resolved account on the socket', async () => {
    (verifier.verifyAccessToken as jest.Mock).mockResolvedValue({ issuer: 'issuer', subject: 'subject', audience: ['api'] });
    (identities.resolveOrProvision as jest.Mock).mockResolvedValue({ userId: 'user-123', created: false });
    const socket = { handshake: { auth: { accessToken: 'header.payload.signature' } }, disconnect: jest.fn(), data: {} } as any;
    await gateway.handleConnection(socket);
    expect(socket.data.userId).toBe('user-123');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('does not join a session room when membership lookup fails', async () => {
    (audio.join as jest.Mock).mockResolvedValue({joined:true});
    (audio.getSession as jest.Mock).mockRejectedValue(new Error('not a member'));
    const socket = { data: { userId: 'user-123' }, join: jest.fn(), emit: jest.fn() } as any;
    const result = await gateway.join(socket, { sessionId: '11111111-1111-4111-8111-111111111111' });
    expect(result).toEqual({ event: 'audio:error', data: { code: 'SESSION_ACCESS_DENIED' } });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins only an authorized session and emits its initial snapshot', async () => {
    const snapshot = { id: '11111111-1111-4111-8111-111111111111', server_version: 4 };
    (audio.join as jest.Mock).mockResolvedValue({joined:true});
    (audio.getSession as jest.Mock).mockResolvedValue(snapshot);
    gateway.server = {to:jest.fn(()=>({emit:jest.fn()}))} as any;
    const socket = { data: { userId: 'user-123' }, join: jest.fn(), emit: jest.fn() } as any;
    const result = await gateway.join(socket, { sessionId: snapshot.id });
    expect(audio.join).toHaveBeenCalledWith('user-123',snapshot.id);
    expect(socket.join).toHaveBeenCalledWith(`audio-session:${snapshot.id}`);
    expect(socket.emit).toHaveBeenCalledWith('audio:snapshot', snapshot);
    expect(result).toEqual({ event: 'audio:joined', data: { sessionId: snapshot.id, serverVersion: 4 } });
  });
});
