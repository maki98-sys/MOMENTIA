import { Module } from '@nestjs/common';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, OidcBearerGuard],
})
export class NotificationsModule {}
