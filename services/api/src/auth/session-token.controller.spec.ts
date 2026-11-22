import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { SessionTokenService } from './session-token.service';
import { DeviceSessionService } from './device-session.service';
jest.mock('jose',()=>({createRemoteJWKSet:jest.fn(),jwtVerify:jest.fn(),errors:{},SignJWT:jest.fn()}));
jest.mock('./oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { AuthSessionController } from './session-token.controller';

describe('AuthSessionController',()=>{
 const create=jest.fn(),refresh=jest.fn(),revokeSession=jest.fn();
 const sessions={create,refresh} as unknown as SessionTokenService;
 const devices={revokeSession} as unknown as DeviceSessionService;
 const controller=new AuthSessionController(sessions,devices);
 const req={userId:'11111111-1111-4111-8111-111111111111',sessionId:'session-1',auth:{sub:'provider-sub'},headers:{'user-agent':'test-agent'},ip:'127.0.0.1'} as unknown as Request & AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [create,refresh,revokeSession])fn.mockReset();});
 it('creates a session from a verified provider identity and forwards device metadata',()=>{
  create.mockReturnValueOnce({accessToken:'token'});
  expect(controller.create(req,{deviceId:'11111111-1111-4111-8111-111111111111'})).toEqual({accessToken:'token'});
  expect(create).toHaveBeenCalledWith(req.userId,'11111111-1111-4111-8111-111111111111',{userAgent:'test-agent',ipAddress:'127.0.0.1'});
 });
 it('rejects session creation without provider auth or with extra/invalid fields',()=>{
  expect(()=>controller.create({...req,auth:undefined} as Request & AuthenticatedRequest,{})).toThrow();
  expect(()=>controller.create(req,{deviceId:'not-a-uuid'})).toThrow();
  expect(()=>controller.create(req,{deviceId:'11111111-1111-4111-8111-111111111111',extra:1})).toThrow();
  expect(create).not.toHaveBeenCalled();
 });
 it('refreshes using only the supplied refresh token',()=>{
  refresh.mockReturnValueOnce({rotated:true});
  expect(controller.refresh({refreshToken:'refresh-value'})).toEqual({rotated:true});
  expect(refresh).toHaveBeenCalledWith('refresh-value');
 });
 it('rejects malformed refresh payloads before service invocation',()=>{
  expect(()=>controller.refresh({refreshToken:42})).toThrow();
  expect(()=>controller.refresh({refreshToken:'x',extra:true})).toThrow();
  expect(()=>controller.refresh(null)).toThrow();
  expect(refresh).not.toHaveBeenCalled();
 });
 it('logs out only the current authenticated MOMENTIA session',()=>{
  revokeSession.mockReturnValueOnce({revoked:true});
  expect(controller.logout(req)).toEqual({revoked:true});
  expect(revokeSession).toHaveBeenCalledWith(req.userId,req.sessionId);
 });
 it('rejects logout without a MOMENTIA session identifier',()=>{
  expect(()=>controller.logout({...req,sessionId:undefined} as Request & AuthenticatedRequest)).toThrow();
  expect(revokeSession).not.toHaveBeenCalled();
 });
});
