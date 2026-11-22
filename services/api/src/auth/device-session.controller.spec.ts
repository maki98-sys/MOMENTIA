import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { DeviceSessionService } from './device-session.service';

jest.mock('./oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { DeviceSessionController } from './device-session.controller';

describe('DeviceSessionController', () => {
  const registerDevice = jest.fn();
  const listDevices = jest.fn();
  const heartbeat = jest.fn();
  const revokeDevice = jest.fn();
  const listSessions = jest.fn();
  const revokeSession = jest.fn();
  const revokeAllSessions = jest.fn();
  const service = {
    registerDevice, listDevices, heartbeat, revokeDevice,
    listSessions, revokeSession, revokeAllSessions,
  } as unknown as DeviceSessionService;
  const controller = new DeviceSessionController(service);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;

  beforeEach(() => {
    for (const mock of [registerDevice, listDevices, heartbeat, revokeDevice, listSessions, revokeSession, revokeAllSessions]) {
      mock.mockReset();
    }
  });

  it('registers a device with the authenticated user and supplied body', () => {
    const body = { deviceId: 'device-1', platform: 'ios' };
    registerDevice.mockReturnValueOnce({ id: 'device-1' });
    expect(controller.register(request, body)).toEqual({ id: 'device-1' });
    expect(registerDevice).toHaveBeenCalledWith(request.userId, body);
  });

  it('lists only the authenticated user devices', () => {
    listDevices.mockReturnValueOnce([{ id: 'device-1' }]);
    expect(controller.listDevices(request)).toEqual([{ id: 'device-1' }]);
    expect(listDevices).toHaveBeenCalledWith(request.userId);
  });

  it('scopes device heartbeat and revocation to the authenticated user', () => {
    heartbeat.mockReturnValueOnce({ ok: true });
    revokeDevice.mockReturnValueOnce({ revoked: true });
    expect(controller.heartbeat(request, 'device-1')).toEqual({ ok: true });
    expect(controller.revokeDevice(request, 'device-2')).toEqual({ revoked: true });
    expect(heartbeat).toHaveBeenCalledWith(request.userId, 'device-1');
    expect(revokeDevice).toHaveBeenCalledWith(request.userId, 'device-2');
  });

  it('lists sessions for the authenticated user', () => {
    listSessions.mockReturnValueOnce([{ id: 'session-1' }]);
    expect(controller.listSessions(request)).toEqual([{ id: 'session-1' }]);
    expect(listSessions).toHaveBeenCalledWith(request.userId);
  });

  it('scopes single-session and all-session revocation to the authenticated user', () => {
    revokeSession.mockReturnValueOnce({ revoked: true });
    revokeAllSessions.mockReturnValueOnce({ revoked: 3 });
    expect(controller.revokeSession(request, 'session-1')).toEqual({ revoked: true });
    expect(controller.revokeAllSessions(request)).toEqual({ revoked: 3 });
    expect(revokeSession).toHaveBeenCalledWith(request.userId, 'session-1');
    expect(revokeAllSessions).toHaveBeenCalledWith(request.userId);
  });
});
