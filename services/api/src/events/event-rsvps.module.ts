import { Module } from '@nestjs/common';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { EventRsvpsController } from './event-rsvps.controller';
import { EventRsvpsService } from './event-rsvps.service';

@Module({
  controllers:[EventRsvpsController],
  providers:[EventRsvpsService,OidcBearerGuard],
  exports:[EventRsvpsService],
})
export class EventRsvpsModule {}
