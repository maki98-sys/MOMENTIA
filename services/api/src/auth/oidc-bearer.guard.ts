import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class OidcBearerGuard implements CanActivate {
  constructor(private readonly verifier: OidcTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = typeof authorization === 'string'
      ? /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(authorization)
      : null;
    if (!match) throw new UnauthorizedException('A bearer access token is required.');
    request.auth = await this.verifier.verifyAccessToken(match[1]);
    return true;
  }
}
