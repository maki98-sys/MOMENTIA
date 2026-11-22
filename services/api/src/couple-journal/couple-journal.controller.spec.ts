import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { CoupleJournalService } from './couple-journal.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { CoupleJournalController } from './couple-journal.controller';

describe('CoupleJournalController',()=>{
 const list=jest.fn(),putKeyEnvelope=jest.fn(),getKeyEnvelope=jest.fn(),create=jest.fn(),update=jest.fn(),remove=jest.fn();
 const service={list,putKeyEnvelope,getKeyEnvelope,create,update,remove} as unknown as CoupleJournalService;
 const controller=new CoupleJournalController(service);
 const req={userId:'user-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [list,putKeyEnvelope,getKeyEnvelope,create,update,remove])fn.mockReset();});
 it('lists journal entries for the caller with the default page size',()=>{
  list.mockReturnValueOnce([]);
  expect(controller.list(req,'couple-1')).toEqual([]);
  expect(list).toHaveBeenCalledWith('couple-1','user-1',30);
 });
 it('forwards an explicit list limit for service-side bounding',()=>{
  controller.list(req,'couple-2','75');
  expect(list).toHaveBeenCalledWith('couple-2','user-1',75);
 });
 it('stores a key envelope for the authenticated partner and couple space',()=>{
  const body={keyVersion:2,algorithm:'X25519-HKDF-SHA256-AES256GCM'};
  putKeyEnvelope.mockReturnValueOnce({keyVersion:2});
  expect(controller.putKeyEnvelope(req,'couple-3',body)).toEqual({keyVersion:2});
  expect(putKeyEnvelope).toHaveBeenCalledWith('couple-3','user-1',body);
 });
 it('retrieves only the caller envelope and forwards an optional key version',()=>{
  getKeyEnvelope.mockReturnValueOnce({envelope:null});
  expect(controller.getKeyEnvelope(req,'couple-4','3')).toEqual({envelope:null});
  expect(getKeyEnvelope).toHaveBeenCalledWith('couple-4','user-1','3');
 });
 it('creates encrypted entries for the caller in the selected couple space',()=>{
  const body={ciphertext:'YQ==',nonce:'AAAAAAAAAAAAAAAA'};
  create.mockReturnValueOnce({id:'entry-1'});
  expect(controller.create(req,'couple-5',body)).toEqual({id:'entry-1'});
  expect(create).toHaveBeenCalledWith('couple-5','user-1',body);
 });
 it('updates and deletes only the selected entry within the caller couple space',()=>{
  const body={ciphertext:'Yg==',nonce:'AAAAAAAAAAAAAAAA'};
  update.mockReturnValueOnce({id:'entry-2'});
  remove.mockReturnValueOnce({deleted:true,id:'entry-2'});
  expect(controller.update(req,'couple-6','entry-2',body)).toEqual({id:'entry-2'});
  expect(update).toHaveBeenCalledWith('couple-6','entry-2','user-1',body);
  expect(controller.remove(req,'couple-6','entry-2')).toEqual({deleted:true,id:'entry-2'});
  expect(remove).toHaveBeenCalledWith('couple-6','entry-2','user-1');
 });
});
