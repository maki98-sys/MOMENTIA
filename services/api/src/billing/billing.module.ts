import { Module } from '@nestjs/common';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingWebhookWorkerController } from './billing-webhook-worker.controller';

@Module({
  controllers: [BillingController, BillingWebhookWorkerController],
  providers: [BillingService, BillingWebhookService, OidcBearerGuard],
  exports: [BillingService, BillingWebhookService],
})
export class BillingModule {}
