import { Module } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import { OidcIdentityService } from './oidc-identity.service';
import { DeviceSessionController } from './device-session.controller';
import { DeviceSessionService } from './device-session.service';

@Module({
  controllers: [DeviceSessionController],
  providers: [OidcTokenVerifier, OidcBearerGuard, OidcIdentityService, DeviceSessionService],
  exports: [OidcBearerGuard, OidcTokenVerifier, OidcIdentityService, DeviceSessionService],
})
export class AuthModule {}
