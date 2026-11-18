import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { OidcPrincipal } from './auth.types';

@Injectable()
export class OidcTokenVerifier {
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: ConfigService) {
    this.issuer = config.get<string>('OIDC_ISSUER') ?? '';
    this.audience = config.get<string>('OIDC_AUDIENCE') ?? '';
    const jwksUri = config.get<string>('OIDC_JWKS_URI');
    if (!this.issuer || !this.audience || !jwksUri) return;
    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }

  async verifyAccessToken(token: string): Promise<OidcPrincipal> {
    if (!this.jwks) throw new ServiceUnavailableException('OIDC identity provider is not configured.');
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'iss', 'aud', 'exp'],
        clockTolerance: 5,
      });
      if (!payload.sub || !payload.iss) {
        throw new UnauthorizedException('Token is missing required identity claims.');
      }
      return {
        issuer: payload.iss,
        subject: payload.sub,
        audience: normalizeAudience(payload.aud),
        ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
        ...(typeof payload.email_verified === 'boolean' ? { emailVerified: payload.email_verified } : {}),
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Bearer token is invalid or expired.');
    }
  }
}

function normalizeAudience(aud: JWTPayload['aud']): string[] {
  if (typeof aud === 'string') return [aud];
  return Array.isArray(aud) ? aud : [];
}
