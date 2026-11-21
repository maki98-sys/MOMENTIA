import { Module } from '@nestjs/common';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsWorkerController } from './notifications-worker.controller';

@Module({
  controllers: [NotificationsController, NotificationsWorkerController],
  providers: [NotificationsService, OidcBearerGuard],
})
export class NotificationsModule {}
