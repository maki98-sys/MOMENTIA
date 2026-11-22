jest.mock('jose', () => ({
  SignJWT: jest.fn(),
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  errors: {},
}));

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SessionTokenService } from './session-token.service';
import { SessionRetentionWorkerController } from './session-retention-worker.controller';

describe('SessionRetentionWorkerController', () => {
  const cleanupExpiredSessions = jest.fn();
  const get = jest.fn();
  const controller = new SessionRetentionWorkerController(
    { cleanupExpiredSessions } as unknown as SessionTokenService,
    { get } as unknown as ConfigService,
  );

  beforeEach(() => {
    cleanupExpiredSessions.mockReset();
    get.mockReset().mockReturnValue('a'.repeat(32));
  });

  it('rejects missing, incorrect, and unconfigured worker credentials', () => {
    expect(() => controller.cleanup(undefined, {})).toThrow(UnauthorizedException);
    expect(() => controller.cleanup('incorrect', {})).toThrow(UnauthorizedException);
    get.mockReturnValue(undefined);
    expect(() => controller.cleanup('a'.repeat(32), {})).toThrow(UnauthorizedException);
    expect(cleanupExpiredSessions).not.toHaveBeenCalled();
  });

  it('cleans expired sessions with the default bounded batch size', async () => {
    cleanupExpiredSessions.mockResolvedValueOnce({ cleaned: 4 });
    await expect(controller.cleanup('a'.repeat(32), {})).resolves.toEqual({ cleaned: 4 });
    expect(cleanupExpiredSessions).toHaveBeenCalledWith(100);
  });

  it('accepts an explicit valid batch size', async () => {
    cleanupExpiredSessions.mockResolvedValueOnce({ cleaned: 7 });
    await expect(controller.cleanup('a'.repeat(32), { limit: 7 })).resolves.toEqual({ cleaned: 7 });
    expect(cleanupExpiredSessions).toHaveBeenCalledWith(7);
  });

  it('rejects malformed or oversized cleanup payloads before invoking the service', () => {
    expect(() => controller.cleanup('a'.repeat(32), { limit: 0 })).toThrow(UnauthorizedException);
    expect(() => controller.cleanup('a'.repeat(32), { limit: 501 })).toThrow(UnauthorizedException);
    expect(() => controller.cleanup('a'.repeat(32), { limit: 10, force: true })).toThrow(UnauthorizedException);
    expect(() => controller.cleanup('a'.repeat(32), [])).toThrow(UnauthorizedException);
    expect(cleanupExpiredSessions).not.toHaveBeenCalled();
  });
});
