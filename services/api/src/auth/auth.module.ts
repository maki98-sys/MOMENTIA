import { Module } from '@nestjs/common';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
import { OidcIdentityService } from './oidc-identity.service';
import { DeviceSessionController } from './device-session.controller';
import { DeviceSessionService } from './device-session.service';
import { SessionTokenService } from './session-token.service';
import { AuthSessionController } from './session-token.controller';
import { AuthIdentityController } from './auth-identity.controller';
import { SessionRetentionWorkerController } from './session-retention-worker.controller';

@Module({
  controllers: [DeviceSessionController, AuthSessionController, AuthIdentityController, SessionRetentionWorkerController],
  providers: [OidcTokenVerifier, OidcBearerGuard, OidcIdentityService, DeviceSessionService, SessionTokenService],
  exports: [OidcBearerGuard, OidcTokenVerifier, OidcIdentityService, DeviceSessionService, SessionTokenService],
})
export class AuthModule {}
