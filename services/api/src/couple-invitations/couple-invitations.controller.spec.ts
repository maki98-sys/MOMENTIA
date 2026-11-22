import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { CoupleInvitationsService } from './couple-invitations.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { CoupleInvitationsController } from './couple-invitations.controller';

describe('CoupleInvitationsController',()=>{
 const create=jest.fn(),validateCreateInput=jest.fn(),list=jest.fn(),revoke=jest.fn(),accept=jest.fn();
 const service={create,validateCreateInput,list,revoke,accept} as unknown as CoupleInvitationsService;
 const controller=new CoupleInvitationsController(service);
 const req={userId:'user-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [create,validateCreateInput,list,revoke,accept])fn.mockReset();});
 it('validates invitation input before creating it for the caller',()=>{
  const body={inviteeUserId:'user-2'},validated={inviteeUserId:'user-2'};
  validateCreateInput.mockReturnValueOnce(validated);create.mockReturnValueOnce({id:'invite-1'});
  expect(controller.create(req,body)).toEqual({id:'invite-1'});
  expect(validateCreateInput).toHaveBeenCalledWith(body);
  expect(create).toHaveBeenCalledWith('user-1',validated);
 });
 it('lists invitations for the authenticated account only',()=>{
  list.mockReturnValueOnce([]);
  expect(controller.list(req)).toEqual([]);
  expect(list).toHaveBeenCalledWith('user-1');
 });
 it('revokes the requested invitation under the caller identity',()=>{
  revoke.mockReturnValueOnce({revoked:true});
  expect(controller.revoke(req,'invite-2')).toEqual({revoked:true});
  expect(revoke).toHaveBeenCalledWith('user-1','invite-2');
 });
 it('accepts using a string token from an object payload',()=>{
  accept.mockReturnValueOnce({spaceId:'space-1'});
  expect(controller.accept(req,{token:'a'.repeat(43)})).toEqual({spaceId:'space-1'});
  expect(accept).toHaveBeenCalledWith('user-1','a'.repeat(43));
 });
 it('passes a safe empty token for malformed accept payloads for service rejection',()=>{
  controller.accept(req,{token:42});
  controller.accept(req,null);
  expect(accept).toHaveBeenNthCalledWith(1,'user-1','');
  expect(accept).toHaveBeenNthCalledWith(2,'user-1','');
 });
});
