import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { BillingService } from './billing.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { BillingController } from './billing.controller';

describe('BillingController',()=>{
 const listPlans=jest.fn(),getEntitlements=jest.fn(),listMySubscriptions=jest.fn();
 const service={listPlans,getEntitlements,listMySubscriptions} as unknown as BillingService;
 const controller=new BillingController(service);
 const req={userId:'subscriber-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [listPlans,getEntitlements,listMySubscriptions])fn.mockReset();});
 it('returns public plans from the billing service',()=>{
  listPlans.mockReturnValueOnce([{code:'free'}]);
  expect(controller.listPlans()).toEqual([{code:'free'}]);
  expect(listPlans).toHaveBeenCalledWith();
 });
 it('loads entitlements only for the authenticated user',()=>{
  getEntitlements.mockReturnValueOnce({plan_code:'free'});
  expect(controller.getEntitlements(req)).toEqual({plan_code:'free'});
  expect(getEntitlements).toHaveBeenCalledWith('subscriber-1');
 });
 it('lists subscriptions only for the authenticated user',()=>{
  listMySubscriptions.mockReturnValueOnce([]);
  expect(controller.listMySubscriptions(req)).toEqual([]);
  expect(listMySubscriptions).toHaveBeenCalledWith('subscriber-1');
 });
});
