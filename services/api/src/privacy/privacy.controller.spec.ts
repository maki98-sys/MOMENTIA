import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { PrivacyService } from './privacy.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { PrivacyController } from './privacy.controller';

describe('PrivacyController',()=>{
 const exportMyData=jest.fn(),requestDeletion=jest.fn(),getDeletionStatus=jest.fn(),cancelDeletion=jest.fn();
 const service={exportMyData,requestDeletion,getDeletionStatus,cancelDeletion} as unknown as PrivacyService;
 const controller=new PrivacyController(service);
 const req={userId:'account-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [exportMyData,requestDeletion,getDeletionStatus,cancelDeletion])fn.mockReset();});
 it('exports only the authenticated account data',()=>{
  exportMyData.mockReturnValueOnce({accountId:'account-1'});
  expect(controller.exportMyData(req)).toEqual({accountId:'account-1'});
  expect(exportMyData).toHaveBeenCalledWith('account-1');
 });
 it('requests deletion for the authenticated account',()=>{
  requestDeletion.mockReturnValueOnce({status:'pending'});
  expect(controller.requestDeletion(req)).toEqual({status:'pending'});
  expect(requestDeletion).toHaveBeenCalledWith('account-1');
 });
 it('reads deletion status for the authenticated account',()=>{
  getDeletionStatus.mockReturnValueOnce({status:'none'});
  expect(controller.deletionStatus(req)).toEqual({status:'none'});
  expect(getDeletionStatus).toHaveBeenCalledWith('account-1');
 });
 it('cancels deletion only for the authenticated account',()=>{
  cancelDeletion.mockReturnValueOnce({status:'cancelled'});
  expect(controller.cancelDeletion(req)).toEqual({status:'cancelled'});
  expect(cancelDeletion).toHaveBeenCalledWith('account-1');
 });
});
