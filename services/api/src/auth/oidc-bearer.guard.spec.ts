jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(),
  errors: { JOSEError: class JOSEError extends Error {} },
}));

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import { OidcIdentityService } from './oidc-identity.service';
import { SessionTokenService } from './session-token.service';

describe('OidcBearerGuard', () => {
  const verifier = { verifyAccessToken: jest.fn() } as unknown as OidcTokenVerifier;
  const identities = { resolveOrProvision: jest.fn() } as unknown as OidcIdentityService;
  const sessions = { verifyAccessToken: jest.fn() } as unknown as SessionTokenService;
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects requests without a bearer token', async () => {
    const guard = new OidcBearerGuard(verifier, identities, sessions);
    const request = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
    expect(identities.resolveOrProvision).not.toHaveBeenCalled();
  });

  it('verifies the bearer token and attaches the resolved MOMENTIA user', async () => {
    const principal = { issuer: 'https://identity.example.test/', subject: 'subject-123', audience: ['momentia-api'] };
    (verifier.verifyAccessToken as jest.Mock).mockResolvedValue(principal);
    (identities.resolveOrProvision as jest.Mock).mockResolvedValue({ userId: 'user-1', created: true });
    const guard = new OidcBearerGuard(verifier, identities, sessions);
    const token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith(token);
    expect(identities.resolveOrProvision).toHaveBeenCalledWith(principal);
    expect(request).toHaveProperty('auth', principal);
    expect(request).toHaveProperty('userId', 'user-1');
  });
});
