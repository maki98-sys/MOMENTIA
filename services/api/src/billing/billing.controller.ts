import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { BillingService } from './billing.service';

@Controller()
@UseGuards(OidcBearerGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing/plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @Get('me/entitlements')
  getEntitlements(@Req() request: Request & AuthenticatedRequest) {
    return this.billing.getEntitlements(request.userId!);
  }

  @Get('me/subscriptions')
  listMySubscriptions(@Req() request: Request & AuthenticatedRequest) {
    return this.billing.listMySubscriptions(request.userId!);
  }
}
