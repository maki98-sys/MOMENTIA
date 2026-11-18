import { Module } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';

@Module({
  providers: [OidcTokenVerifier, OidcBearerGuard],
  exports: [OidcBearerGuard, OidcTokenVerifier],
})
export class AuthModule {}
