import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { JoinRequestsService } from './join-requests.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { JoinRequestsController } from './join-requests.controller';

describe('JoinRequestsController',()=>{
 const create=jest.fn(),list=jest.fn(),review=jest.fn(),cancel=jest.fn();
 const service={create,list,review,cancel} as unknown as JoinRequestsService;
 const controller=new JoinRequestsController(service);
 const req={userId:'user-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [create,list,review,cancel])fn.mockReset();});
 it('creates a join request for the authenticated user and route space',()=>{
  create.mockReturnValueOnce({id:'request-1'});
  expect(controller.create(req,'space-1')).toEqual({id:'request-1'});
  expect(create).toHaveBeenCalledWith('user-1','space-1');
 });
 it('lists requests using the caller and route space',()=>{
  list.mockReturnValueOnce([]);
  expect(controller.list(req,'space-2')).toEqual([]);
  expect(list).toHaveBeenCalledWith('user-1','space-2');
 });
 it('approves a specific request with the approved decision',()=>{
  review.mockReturnValueOnce({state:'approved'});
  expect(controller.approve(req,'space-3','request-3')).toEqual({state:'approved'});
  expect(review).toHaveBeenCalledWith('user-1','space-3','request-3','approved');
 });
 it('rejects a specific request with the rejected decision',()=>{
  review.mockReturnValueOnce({state:'rejected'});
  expect(controller.reject(req,'space-4','request-4')).toEqual({state:'rejected'});
  expect(review).toHaveBeenCalledWith('user-1','space-4','request-4','rejected');
 });
 it('cancels only the specified request in the caller space',()=>{
  cancel.mockReturnValueOnce({cancelled:true});
  expect(controller.cancel(req,'space-5','request-5')).toEqual({cancelled:true});
  expect(cancel).toHaveBeenCalledWith('user-1','space-5','request-5');
 });
});
