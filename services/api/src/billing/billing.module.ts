import { Module } from '@nestjs/common';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  controllers: [BillingController],
  providers: [BillingService, OidcBearerGuard],
  exports: [BillingService],
})
export class BillingModule {}
