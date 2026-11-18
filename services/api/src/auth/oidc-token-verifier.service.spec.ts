jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
  errors: { JOSEError: class JOSEError extends Error {} },
}));

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

const ISSUER = 'https://identity.example.test/';
const AUDIENCE = 'momentia-api';
const JWKS_URI = 'https://identity.example.test/.well-known/jwks.json';

function createConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('OidcTokenVerifier', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fails closed when the identity provider is not configured', async () => {
    const verifier = new OidcTokenVerifier(createConfig({}));
    await expect(verifier.verifyAccessToken('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('creates a remote JWKS resolver with bounded network/cache settings', () => {
    new OidcTokenVerifier(createConfig({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: JWKS_URI,
    }));

    expect(createRemoteJWKSet).toHaveBeenCalledWith(new URL(JWKS_URI), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  });

  it('accepts a verified token and returns only the minimal principal', async () => {
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {
        iss: ISSUER,
        sub: 'external-subject-1',
        aud: [AUDIENCE],
        exp: 2_000_000_000,
        email: 'person@example.test',
        email_verified: true,
        private_claim: 'must-not-leak',
      },
    });
    const verifier = new OidcTokenVerifier(createConfig({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: JWKS_URI,
    }));

    await expect(verifier.verifyAccessToken('signed-access-token')).resolves.toEqual({
      issuer: ISSUER,
      subject: 'external-subject-1',
      audience: [AUDIENCE],
      email: 'person@example.test',
      emailVerified: true,
    });
    expect(jwtVerify).toHaveBeenCalledWith('signed-access-token', expect.any(Function), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'iss', 'aud', 'exp'],
      clockTolerance: 5,
    });
  });

  it('rejects JOSE validation errors as unauthorized', async () => {
    (jwtVerify as jest.Mock).mockRejectedValue(new errors.JOSEError('invalid signature'));
    const verifier = new OidcTokenVerifier(createConfig({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: JWKS_URI,
    }));

    await expect(verifier.verifyAccessToken('bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reports JWKS/network failures as service unavailable, not bad credentials', async () => {
    (jwtVerify as jest.Mock).mockRejectedValue(new TypeError('network unavailable'));
    const verifier = new OidcTokenVerifier(createConfig({
      OIDC_ISSUER: ISSUER,
      OIDC_AUDIENCE: AUDIENCE,
      OIDC_JWKS_URI: JWKS_URI,
    }));

    await expect(verifier.verifyAccessToken('token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
