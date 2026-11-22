import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { InvitationsService } from './invitations.service';
jest.mock('../auth/oidc-bearer.guard', () => ({ OidcBearerGuard: class OidcBearerGuard {} }));
import { InvitationsController } from './invitations.controller';

describe('InvitationsController',()=>{
 const create=jest.fn(),validateCreateInput=jest.fn(),list=jest.fn(),revoke=jest.fn(),preview=jest.fn(),accept=jest.fn();
 const service={create,validateCreateInput,list,revoke,preview,accept} as unknown as InvitationsService;
 const controller=new InvitationsController(service);
 const request={userId:'11111111-1111-4111-8111-111111111111'} as Request & AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [create,validateCreateInput,list,revoke,preview,accept])fn.mockReset();});
 it('validates invitation input before creating in the requested space',()=>{const body={role:'guest'};const input={role:'guest',expiresInDays:7,maxUses:1};validateCreateInput.mockReturnValueOnce(input);create.mockReturnValueOnce({id:'invite-1'});expect(controller.create(request,'space-1',body)).toEqual({id:'invite-1'});expect(validateCreateInput).toHaveBeenCalledWith(body);expect(create).toHaveBeenCalledWith(request.userId,'space-1',input);});
 it('lists invitations in the requested space for the caller',()=>{list.mockReturnValueOnce([]);expect(controller.list(request,'space-1')).toEqual([]);expect(list).toHaveBeenCalledWith(request.userId,'space-1');});
 it('revokes the specified invitation in the specified space',()=>{revoke.mockReturnValueOnce({revoked:true});expect(controller.revoke(request,'space-1','invite-1')).toEqual({revoked:true});expect(revoke).toHaveBeenCalledWith(request.userId,'space-1','invite-1');});
 it('previews a supplied string token',()=>{preview.mockReturnValueOnce({valid:true});expect(controller.preview({token:'token-value'})).toEqual({valid:true});expect(preview).toHaveBeenCalledWith('token-value');});
 it('passes a non-string preview token as empty for service validation',()=>{controller.preview({token:42});expect(preview).toHaveBeenCalledWith('');});
 it('accepts a supplied string token under authenticated user scope',()=>{accept.mockReturnValueOnce({membership:'active'});expect(controller.accept(request,{token:'token-value'})).toEqual({membership:'active'});expect(accept).toHaveBeenCalledWith(request.userId,'token-value');});
 it('passes a non-string acceptance token as empty for service validation',()=>{controller.accept(request,{token:null});expect(accept).toHaveBeenCalledWith(request.userId,'');});
});
