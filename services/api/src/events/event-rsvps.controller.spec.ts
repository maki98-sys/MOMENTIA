import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { EventRsvpsService } from './event-rsvps.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { EventRsvpsController } from './event-rsvps.controller';

describe('EventRsvpsController',()=>{
 const respond=jest.fn(),summary=jest.fn(),remove=jest.fn();
 const service={respond,summary,remove} as unknown as EventRsvpsService;
 const controller=new EventRsvpsController(service);
 const req={userId:'user-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{respond.mockReset();summary.mockReset();remove.mockReset();});
 it('submits the caller RSVP with the route space and unmodified payload',()=>{
  const body={response:'going',guestCount:2};respond.mockReturnValueOnce({id:'rsvp-1'});
  expect(controller.respond(req,'space-1',body)).toEqual({id:'rsvp-1'});
  expect(respond).toHaveBeenCalledWith('user-1','space-1',body);
 });
 it('returns the RSVP summary scoped to the authenticated caller and space',()=>{
  summary.mockReturnValueOnce({going:2});
  expect(controller.summary(req,'space-2')).toEqual({going:2});
  expect(summary).toHaveBeenCalledWith('user-1','space-2');
 });
 it('removes only the caller RSVP in the requested space',()=>{
  remove.mockReturnValueOnce({removed:true});
  expect(controller.remove(req,'space-3')).toEqual({removed:true});
  expect(remove).toHaveBeenCalledWith('user-1','space-3');
 });
});
