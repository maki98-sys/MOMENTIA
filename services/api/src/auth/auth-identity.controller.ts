import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcIdentityService } from './oidc-identity.service';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

@Controller('auth/identities')
@UseGuards(OidcBearerGuard)
export class AuthIdentityController {
  constructor(
    private readonly identities: OidcIdentityService,
    private readonly verifier: OidcTokenVerifier,
  ) {}

  @Post('link')
  async link(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    if (!req.userId || !req.sessionId) {
      throw new BadRequestException('An authenticated MOMENTIA session is required to link an identity.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body as Record<string, unknown>).some(key => key !== 'identityToken') ||
        typeof (body as Record<string, unknown>).identityToken !== 'string') {
      throw new BadRequestException('An identityToken from the additional identity provider is required.');
    }
    const token = (body as { identityToken: string }).identityToken;
    if (token.length < 20 || token.length > 16384) {
      throw new BadRequestException('The external identity token has an invalid length.');
    }
    const principal = await this.verifier.verifyAccessToken(token);
    return this.identities.linkAuthenticatedIdentity(req.userId, principal);
  }
  @Post('unlink')
  async unlink(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    if (!req.userId || !req.sessionId) {
      throw new BadRequestException('An authenticated MOMENTIA session is required to unlink an identity.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body as Record<string, unknown>).some(key => key !== 'identityToken') ||
        typeof (body as Record<string, unknown>).identityToken !== 'string') {
      throw new BadRequestException('A fresh identityToken proving control of the identity is required.');
    }
    const token = (body as { identityToken: string }).identityToken;
    if (token.length < 20 || token.length > 16384) {
      throw new BadRequestException('The external identity token has an invalid length.');
    }
    const principal = await this.verifier.verifyAccessToken(token);
    return this.identities.unlinkAuthenticatedIdentity(req.userId, principal);
  }

}
