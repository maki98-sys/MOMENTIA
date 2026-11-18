import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

describe('OidcBearerGuard', () => {
  const verifier = { verifyAccessToken: jest.fn() } as unknown as OidcTokenVerifier;
  beforeEach(() => jest.clearAllMocks());

  it('rejects requests without a bearer token', async () => {
    const guard = new OidcBearerGuard(verifier);
    const request = { headers: {} };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('verifies the bearer token and attaches the principal', async () => {
    const principal = { issuer: 'https://identity.example.test/', subject: 'subject-123', audience: ['momentia-api'] };
    (verifier.verifyAccessToken as jest.Mock).mockResolvedValue(principal);
    const guard = new OidcBearerGuard(verifier);
    const token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.verifyAccessToken).toHaveBeenCalledWith(token);
    expect(request).toHaveProperty('auth', principal);
  });
});
