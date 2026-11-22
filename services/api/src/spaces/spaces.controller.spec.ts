import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SpacesService } from './spaces.service';
jest.mock('../auth/oidc-bearer.guard', () => ({ OidcBearerGuard: class OidcBearerGuard {} }));
import { SpacesController } from './spaces.controller';

describe('SpacesController', () => {
 const listMine=jest.fn(),create=jest.fn(),validateCreateInput=jest.fn(),updateEvent=jest.fn(),changeLifecycle=jest.fn(),getMine=jest.fn();
 const service={listMine,create,validateCreateInput,updateEvent,changeLifecycle,getMine} as unknown as SpacesService;
 const controller=new SpacesController(service);
 const request={userId:'11111111-1111-4111-8111-111111111111'} as Request & AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [listMine,create,validateCreateInput,updateEvent,changeLifecycle,getMine])fn.mockReset();});
 it('lists spaces for the authenticated user',()=>{listMine.mockReturnValueOnce([]);expect(controller.listMine(request)).toEqual([]);expect(listMine).toHaveBeenCalledWith(request.userId);});
 it('validates create input before creating under the caller identity',()=>{const body={type:'EVENT',name:'Launch'};const input={type:'EVENT',name:'Launch',visibility:'private'};validateCreateInput.mockReturnValueOnce(input);create.mockReturnValueOnce({id:'space-1'});expect(controller.create(request,body)).toEqual({id:'space-1'});expect(validateCreateInput).toHaveBeenCalledWith(body);expect(create).toHaveBeenCalledWith(request.userId,input);});
 it('forwards event updates with caller, space and body',()=>{const body={name:'Updated'};updateEvent.mockReturnValueOnce({name:'Updated'});expect(controller.updateEvent(request,'space-1',body)).toEqual({name:'Updated'});expect(updateEvent).toHaveBeenCalledWith(request.userId,'space-1',body);});
 it('extracts lifecycle action only from a plain object',()=>{changeLifecycle.mockReturnValueOnce({status:'archived'});expect(controller.changeLifecycle(request,'space-1',{action:'archive'})).toEqual({status:'archived'});expect(changeLifecycle).toHaveBeenLastCalledWith(request.userId,'space-1','archive');controller.changeLifecycle(request,'space-2',null);expect(changeLifecycle).toHaveBeenLastCalledWith(request.userId,'space-2',undefined);controller.changeLifecycle(request,'space-3',['close']);expect(changeLifecycle).toHaveBeenLastCalledWith(request.userId,'space-3',undefined);});
 it('gets a space within the authenticated user scope',()=>{getMine.mockReturnValueOnce({id:'space-1'});expect(controller.getMine(request,'space-1')).toEqual({id:'space-1'});expect(getMine).toHaveBeenCalledWith(request.userId,'space-1');});
});
