jest.mock('../auth/oidc-token-verifier.service', () => ({ OidcTokenVerifier: class OidcTokenVerifier {} }));
jest.mock('../auth/oidc-identity.service', () => ({ OidcIdentityService: class OidcIdentityService {} }));

import { AudioGateway } from './audio.gateway';
import { OidcTokenVerifier } from '../auth/oidc-token-verifier.service';
import { OidcIdentityService } from '../auth/oidc-identity.service';
import { AudioService } from './audio.service';

describe('AudioGateway', () => {
  const verifier = { verifyAccessToken: jest.fn() } as unknown as OidcTokenVerifier;
  const identities = { resolveOrProvision: jest.fn() } as unknown as OidcIdentityService;
  const audio = { getSession: jest.fn(), heartbeat: jest.fn() } as unknown as AudioService;
  let gateway: AudioGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new AudioGateway(verifier, identities, audio);
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
    (audio.getSession as jest.Mock).mockRejectedValue(new Error('not a member'));
    const socket = { data: { userId: 'user-123' }, join: jest.fn(), emit: jest.fn() } as any;
    const result = await gateway.join(socket, { sessionId: '11111111-1111-4111-8111-111111111111' });
    expect(result).toEqual({ event: 'audio:error', data: { code: 'SESSION_ACCESS_DENIED' } });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('joins only an authorized session and emits its initial snapshot', async () => {
    const snapshot = { id: '11111111-1111-4111-8111-111111111111', server_version: 4 };
    (audio.getSession as jest.Mock).mockResolvedValue(snapshot);
    const socket = { data: { userId: 'user-123' }, join: jest.fn(), emit: jest.fn() } as any;
    const result = await gateway.join(socket, { sessionId: snapshot.id });
    expect(socket.join).toHaveBeenCalledWith(`audio-session:${snapshot.id}`);
    expect(socket.emit).toHaveBeenCalledWith('audio:snapshot', snapshot);
    expect(result).toEqual({ event: 'audio:joined', data: { sessionId: snapshot.id, serverVersion: 4 } });
  });
});
