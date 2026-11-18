import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { AudioController } from './audio.controller';
import { AudioGateway } from './audio.gateway';
import { AudioService } from './audio.service';

@Module({
  imports: [AuthModule],
  controllers: [AudioController],
  providers: [AudioService, AudioGateway, OidcBearerGuard],
})
export class AudioModule {}
