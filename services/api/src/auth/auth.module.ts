import { Module } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import { OidcIdentityService } from './oidc-identity.service';

@Module({
  providers: [OidcTokenVerifier, OidcBearerGuard, OidcIdentityService],
  exports: [OidcBearerGuard, OidcTokenVerifier, OidcIdentityService],
})
export class AuthModule {}
