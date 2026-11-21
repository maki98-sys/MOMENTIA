import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import { OidcIdentityService } from './oidc-identity.service';
import { SessionTokenService } from './session-token.service';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class OidcBearerGuard implements CanActivate {
  constructor(
    private readonly verifier: OidcTokenVerifier,
    private readonly identities: OidcIdentityService,
    private readonly sessions: SessionTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string'
      ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization)
      : null;
    if (!match) throw new UnauthorizedException('A bearer access token is required.');

    if (match[1].startsWith('mta_')) {
      const userId = await this.sessions.verifyAccessToken(match[1]);
      request.userId = userId;
      const tokenPayload = JSON.parse(Buffer.from(match[1].slice(4).split('.')[1], 'base64url').toString('utf8')) as { sid?: string };
      request.sessionId = tokenPayload.sid;
      return true;
    }
    const principal = await this.verifier.verifyAccessToken(match[1]);
    const identity = await this.identities.resolveOrProvision(principal);
    request.auth = principal;
    request.userId = identity.userId;
    return true;
  }
}
