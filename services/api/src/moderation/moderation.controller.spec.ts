import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { ModerationService } from './moderation.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { ModerationController } from './moderation.controller';

describe('ModerationController',()=>{
 const submit=jest.fn(),listMine=jest.fn(),queue=jest.fn(),review=jest.fn();
 const service={submit,listMine,queue,review} as unknown as ModerationService;
 const controller=new ModerationController(service);
 const req={userId:'moderator-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [submit,listMine,queue,review])fn.mockReset();});
 it('submits a report for the authenticated user with the original payload',()=>{
  const body={targetType:'post',targetId:'post-1',reason:'spam'};
  submit.mockReturnValueOnce({id:'report-1'});
  expect(controller.submit(req,body)).toEqual({id:'report-1'});
  expect(submit).toHaveBeenCalledWith('moderator-1',body);
 });
 it('lists the caller reports with default and explicit normalized limits',()=>{
  controller.listMine(req);
  expect(listMine).toHaveBeenLastCalledWith('moderator-1',30);
  controller.listMine(req,'12');
  expect(listMine).toHaveBeenLastCalledWith('moderator-1',12);
 });
 it('loads the moderation queue with default status and limit or supplied filters',()=>{
  controller.queue(req);
  expect(queue).toHaveBeenLastCalledWith('moderator-1','open',50);
  controller.queue(req,'resolved','15');
  expect(queue).toHaveBeenLastCalledWith('moderator-1','resolved',15);
 });
 it('forwards the authenticated reviewer, report id and decision payload',()=>{
  const body={decision:'remove',note:'policy violation'};
  review.mockReturnValueOnce({id:'report-2',status:'resolved'});
  expect(controller.review(req,'report-2',body)).toEqual({id:'report-2',status:'resolved'});
  expect(review).toHaveBeenCalledWith('moderator-1','report-2',body);
 });
});
