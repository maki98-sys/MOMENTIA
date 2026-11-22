import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { AudioService } from './audio.service';
import type { AudioGateway } from './audio.gateway';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { AudioController } from './audio.controller';

describe('AudioController',()=>{
 const methods=['createSession','getActiveSession','getSession','join','heartbeat','leave','addQueueItem','removeQueueItem','updatePlayback','vote'] as const;
 const audioMock=Object.fromEntries(methods.map(name=>[name,jest.fn()]));
 const publishSession=jest.fn();
 const audio=audioMock as unknown as AudioService;
 const gateway={publishSession} as unknown as AudioGateway;
 const controller=new AudioController(audio,gateway);
 const req={userId:'user-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of Object.values(audioMock))fn.mockReset();publishSession.mockReset();});
 it('creates a session using authenticated identity, space and provider',async()=>{
  const body={sourceProvider:'spotify'};audioMock.createSession.mockResolvedValueOnce({id:'session-1'});
  await expect(controller.create(req,'space-1',body)).resolves.toEqual({id:'session-1'});
  expect(audioMock.createSession).toHaveBeenCalledWith('user-1','space-1','spotify');
 });
 it('reads the active session for the authenticated space member',()=>{
  audioMock.getActiveSession.mockReturnValueOnce({session:null});
  expect(controller.active(req,'space-2')).toEqual({session:null});
  expect(audioMock.getActiveSession).toHaveBeenCalledWith('user-1','space-2');
 });
 it('reads a session for the authenticated participant',()=>{
  audioMock.getSession.mockReturnValueOnce({id:'session-2'});
  expect(controller.get(req,'session-2')).toEqual({id:'session-2'});
  expect(audioMock.getSession).toHaveBeenCalledWith('user-1','session-2');
 });
 it('joins and publishes participant-joined only after service success',async()=>{
  audioMock.join.mockResolvedValueOnce({joined:true});
  publishSession.mockResolvedValueOnce({id:'session-3'});
  await expect(controller.join(req,'session-3')).resolves.toEqual({joined:true});
  expect(audioMock.join).toHaveBeenCalledWith('user-1','session-3');
  expect(publishSession).toHaveBeenCalledWith('user-1','session-3','audio:participant:joined');
 });
 it('updates heartbeat without broadcasting',()=>{
  audioMock.heartbeat.mockReturnValueOnce({sessionId:'session-4'});
  expect(controller.heartbeat(req,'session-4')).toEqual({sessionId:'session-4'});
  expect(audioMock.heartbeat).toHaveBeenCalledWith('user-1','session-4');
  expect(publishSession).not.toHaveBeenCalled();
 });
 it('leaves and publishes participant-left after service success',async()=>{
  audioMock.leave.mockResolvedValueOnce({left:true,sessionEnded:false});
  publishSession.mockResolvedValueOnce({});
  await expect(controller.leave(req,'session-5')).resolves.toEqual({left:true,sessionEnded:false});
  expect(publishSession).toHaveBeenCalledWith('user-1','session-5','audio:participant:left');
 });
 it('adds queue items and broadcasts the updated queue',async()=>{
  const body={trackReference:'spotify:track:abc'};audioMock.addQueueItem.mockResolvedValueOnce({id:'item-1'});publishSession.mockResolvedValueOnce({});
  await expect(controller.addQueueItem(req,'session-6',body)).resolves.toEqual({id:'item-1'});
  expect(audioMock.addQueueItem).toHaveBeenCalledWith('user-1','session-6','spotify:track:abc');
  expect(publishSession).toHaveBeenCalledWith('user-1','session-6','audio:queue:updated');
 });
 it('removes the selected queue item and broadcasts the update',async()=>{
  audioMock.removeQueueItem.mockResolvedValueOnce({removed:true});publishSession.mockResolvedValueOnce({});
  await expect(controller.removeQueueItem(req,'session-7','item-7')).resolves.toEqual({removed:true});
  expect(audioMock.removeQueueItem).toHaveBeenCalledWith('user-1','session-7','item-7');
  expect(publishSession).toHaveBeenCalledWith('user-1','session-7','audio:queue:updated');
 });
 it('forwards playback commands and publishes playback updates',async()=>{
  const body={action:'seek',positionMs:12000,expectedVersion:4};audioMock.updatePlayback.mockResolvedValueOnce({serverVersion:5});publishSession.mockResolvedValueOnce({});
  await expect(controller.playback(req,'session-8',body)).resolves.toEqual({serverVersion:5});
  expect(audioMock.updatePlayback).toHaveBeenCalledWith('user-1','session-8',body);
  expect(publishSession).toHaveBeenCalledWith('user-1','session-8','audio:playback:updated');
 });
 it('forwards queue votes and publishes vote updates',async()=>{
  const body={vote:1};audioMock.vote.mockResolvedValueOnce({vote:1});publishSession.mockResolvedValueOnce({});
  await expect(controller.vote(req,'session-9','item-9',body)).resolves.toEqual({vote:1});
  expect(audioMock.vote).toHaveBeenCalledWith('user-1','session-9','item-9',1);
  expect(publishSession).toHaveBeenCalledWith('user-1','session-9','audio:queue:vote-updated');
 });
});
