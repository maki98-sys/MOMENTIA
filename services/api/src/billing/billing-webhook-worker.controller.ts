import { Controller, Get, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { BillingWebhookService } from './billing-webhook.service';

@Controller('internal/billing/webhooks')
export class BillingWebhookWorkerController {
  constructor(private readonly webhooks:BillingWebhookService,private readonly config:ConfigService) {}

  private authorize(token?:string) {
    const expected=this.config.get<string>('BILLING_WORKER_TOKEN');
    if(!expected||!token) throw new UnauthorizedException();
    const a=Buffer.from(token),b=Buffer.from(expected);
    if(a.length!==b.length||!timingSafeEqual(a,b)) throw new UnauthorizedException();
  }

  @Post('process')
  process(@Headers('x-worker-token') token?:string) {
    this.authorize(token);
    return this.webhooks.processBatch(30);
  }

  @Post('recover-stale')
  recover(@Headers('x-worker-token') token?:string) {
    this.authorize(token);
    return this.webhooks.recoverStale(300);
  }

  @Get('dead-letter')
  deadLetter(@Headers('x-worker-token') token?:string,@Query('limit') limit?:string) {
    this.authorize(token);
    return this.webhooks.listDeadLetter(Number(limit)||50);
  }

  @Post(':eventId/retry')
  retry(@Headers('x-worker-token') token?:string,@Param('eventId') eventId?:string) {
    this.authorize(token);
    return this.webhooks.retryDeadLetter(String(eventId??''));
  }
}
