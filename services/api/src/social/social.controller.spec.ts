import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { SocialService } from './social.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { SocialController } from './social.controller';

describe('SocialController',()=>{
 const names=['follow','unfollow','listFollowRequests','respondToFollowRequest','block','unblock','listConnections','feed','create','getPost','comments','addComment','react','removeReaction','updateComment','deleteComment','reactToComment','removeCommentReaction'] as const;
 const mocks=Object.fromEntries(names.map(n=>[n,jest.fn()]));
 const service=mocks as unknown as SocialService;
 const controller=new SocialController(service);
 const req={userId:'viewer-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of Object.values(mocks))fn.mockReset();});
 it('follows and unfollows the requested user as the authenticated actor',()=>{
  mocks.follow.mockReturnValueOnce({state:'accepted'});mocks.unfollow.mockReturnValueOnce({following:false});
  expect(controller.follow(req,'user-2')).toEqual({state:'accepted'});
  expect(mocks.follow).toHaveBeenCalledWith('viewer-1','user-2');
  expect(controller.unfollow(req,'user-2')).toEqual({following:false});
  expect(mocks.unfollow).toHaveBeenCalledWith('viewer-1','user-2');
 });
 it('lists incoming follow requests for the authenticated account',()=>{
  mocks.listFollowRequests.mockReturnValueOnce([]);
  expect(controller.followRequests(req)).toEqual([]);
  expect(mocks.listFollowRequests).toHaveBeenCalledWith('viewer-1');
 });
 it('accepts and rejects requests on behalf of the profile owner',()=>{
  controller.acceptFollowRequest(req,'requester-1');controller.rejectFollowRequest(req,'requester-2');
  expect(mocks.respondToFollowRequest).toHaveBeenNthCalledWith(1,'viewer-1','requester-1','accepted');
  expect(mocks.respondToFollowRequest).toHaveBeenNthCalledWith(2,'viewer-1','requester-2','rejected');
 });
 it('blocks and unblocks the target user as the authenticated actor',()=>{
  controller.block(req,'user-3');controller.unblock(req,'user-3');
  expect(mocks.block).toHaveBeenCalledWith('viewer-1','user-3');
  expect(mocks.unblock).toHaveBeenCalledWith('viewer-1','user-3');
 });
 it('lists following, followers and incoming requests with parsed pagination',()=>{
  controller.following(req,'cursor-a','12');controller.followers(req,undefined,undefined);controller.incomingFollowRequests(req,'cursor-b','7');
  expect(mocks.listConnections).toHaveBeenNthCalledWith(1,'viewer-1','following','cursor-a',12);
  expect(mocks.listConnections).toHaveBeenNthCalledWith(2,'viewer-1','followers',undefined,20);
  expect(mocks.listConnections).toHaveBeenNthCalledWith(3,'viewer-1','requests','cursor-b',7);
 });
 it('rejects invalid connection pagination before calling the service',()=>{
  expect(()=>controller.following(req,undefined,'0')).toThrow();
  expect(()=>controller.followers(req,'x'.repeat(513),'20')).toThrow();
  expect(mocks.listConnections).not.toHaveBeenCalled();
 });
 it('loads feed with authenticated identity and default or supplied pagination',()=>{
  mocks.feed.mockReturnValue([]);
  controller.feed(req);controller.feed(req,'2026-01-01T00:00:00.000Z',15);
  expect(mocks.feed).toHaveBeenNthCalledWith(1,'viewer-1',undefined,20);
  expect(mocks.feed).toHaveBeenNthCalledWith(2,'viewer-1','2026-01-01T00:00:00.000Z',15);
 });
 it('creates a post with the original payload and authenticated author',()=>{
  const body={body:'hello',audience:'followers'};mocks.create.mockReturnValueOnce({id:'post-1'});
  expect(controller.create(req,body)).toEqual({id:'post-1'});
  expect(mocks.create).toHaveBeenCalledWith('viewer-1',body);
 });
 it('loads an authorized post detail and its comments',()=>{
  controller.getPost(req,'post-2');controller.comments(req,'post-2');
  expect(mocks.getPost).toHaveBeenCalledWith('viewer-1','post-2');
  expect(mocks.comments).toHaveBeenCalledWith('viewer-1','post-2');
 });
 it('creates comments and reactions using the authenticated actor',()=>{
  controller.comment(req,'post-3',{body:'nice'});controller.react(req,'post-3',{reaction:'like'});
  expect(mocks.addComment).toHaveBeenCalledWith('viewer-1','post-3','nice');
  expect(mocks.react).toHaveBeenCalledWith('viewer-1','post-3','like');
 });
 it('removes a post reaction for the authenticated actor',()=>{
  controller.unreact(req,'post-4');
  expect(mocks.removeReaction).toHaveBeenCalledWith('viewer-1','post-4');
 });
 it('updates and deletes comments with authenticated ownership context',()=>{
  controller.updateComment(req,'comment-1',{body:'edited'});controller.deleteComment(req,'comment-2');
  expect(mocks.updateComment).toHaveBeenCalledWith('viewer-1','comment-1','edited');
  expect(mocks.deleteComment).toHaveBeenCalledWith('viewer-1','comment-2');
 });
 it('adds and removes comment reactions with authenticated identity',()=>{
  controller.reactToComment(req,'comment-3',{reaction:'heart'});controller.removeCommentReaction(req,'comment-4');
  expect(mocks.reactToComment).toHaveBeenCalledWith('viewer-1','comment-3','heart');
  expect(mocks.removeCommentReaction).toHaveBeenCalledWith('viewer-1','comment-4');
 });
});
