import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { OidcIdentityService } from './oidc-identity.service';
import { OidcTokenVerifier } from './oidc-token-verifier.service';
jest.mock('jose',()=>({createRemoteJWKSet:jest.fn(),jwtVerify:jest.fn(),errors:{},SignJWT:jest.fn()}));
jest.mock('./oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { AuthIdentityController } from './auth-identity.controller';

describe('AuthIdentityController',()=>{
 const listAuthenticatedIdentities=jest.fn(),linkAuthenticatedIdentity=jest.fn(),unlinkAuthenticatedIdentity=jest.fn(),verifyAccessToken=jest.fn();
 const identities={listAuthenticatedIdentities,linkAuthenticatedIdentity,unlinkAuthenticatedIdentity} as unknown as OidcIdentityService;
 const verifier={verifyAccessToken} as unknown as OidcTokenVerifier;
 const controller=new AuthIdentityController(identities,verifier);
 const req={userId:'11111111-1111-4111-8111-111111111111',sessionId:'session-1'} as Request & AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [listAuthenticatedIdentities,linkAuthenticatedIdentity,unlinkAuthenticatedIdentity,verifyAccessToken])fn.mockReset();});
 it('lists identities only with an authenticated MOMENTIA session',()=>{
  listAuthenticatedIdentities.mockReturnValueOnce([{provider:'oidc'}]);
  expect(controller.list(req)).toEqual([{provider:'oidc'}]);
  expect(listAuthenticatedIdentities).toHaveBeenCalledWith(req.userId);
 });
 it('rejects identity listing without a MOMENTIA session',()=>{
  expect(()=>controller.list({...req,sessionId:undefined} as Request & AuthenticatedRequest)).toThrow();
  expect(listAuthenticatedIdentities).not.toHaveBeenCalled();
 });
 it('verifies an additional provider token before linking it to the caller',async()=>{
  const principal={issuer:'https://issuer.example',subject:'subject-1'} as never;
  verifyAccessToken.mockResolvedValueOnce(principal);linkAuthenticatedIdentity.mockResolvedValueOnce({linked:true});
  await expect(controller.link(req,{identityToken:'x'.repeat(40)})).resolves.toEqual({linked:true});
  expect(verifyAccessToken).toHaveBeenCalledWith('x'.repeat(40));
  expect(linkAuthenticatedIdentity).toHaveBeenCalledWith(req.userId,principal);
 });
 it('rejects malformed link payloads before token verification',async()=>{
  await expect(controller.link(req,{identityToken:'short'})).rejects.toThrow();
  await expect(controller.link(req,{identityToken:'x'.repeat(40),extra:true})).rejects.toThrow();
  expect(verifyAccessToken).not.toHaveBeenCalled();
 });
 it('verifies fresh proof before unlinking an identity from the caller account',async()=>{
  const principal={issuer:'https://issuer.example',subject:'subject-2'} as never;
  verifyAccessToken.mockResolvedValueOnce(principal);unlinkAuthenticatedIdentity.mockResolvedValueOnce({unlinked:true});
  await expect(controller.unlink(req,{identityToken:'y'.repeat(40)})).resolves.toEqual({unlinked:true});
  expect(verifyAccessToken).toHaveBeenCalledWith('y'.repeat(40));
  expect(unlinkAuthenticatedIdentity).toHaveBeenCalledWith(req.userId,principal);
 });
 it('rejects unlink requests without a session or a valid token payload',async()=>{
  await expect(controller.unlink({...req,sessionId:undefined} as Request & AuthenticatedRequest,{identityToken:'z'.repeat(40)})).rejects.toThrow();
  await expect(controller.unlink(req,{identityToken:42})).rejects.toThrow();
  expect(verifyAccessToken).not.toHaveBeenCalled();
 });
});
