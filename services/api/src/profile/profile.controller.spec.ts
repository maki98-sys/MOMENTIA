import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { ProfileService } from './profile.service';
jest.mock('../auth/oidc-bearer.guard', () => ({ OidcBearerGuard: class OidcBearerGuard {} }));
import { ProfileController } from './profile.controller';

describe('ProfileController',()=>{
 const getMe=jest.fn(),validateProfileInput=jest.fn(),updateMyProfile=jest.fn();
 const service={getMe,validateProfileInput,updateMyProfile} as unknown as ProfileService;
 const controller=new ProfileController(service);
 const request={userId:'11111111-1111-4111-8111-111111111111'} as Request & AuthenticatedRequest;
 beforeEach(()=>{for(const fn of [getMe,validateProfileInput,updateMyProfile])fn.mockReset();});
 it('retrieves the authenticated user account',()=>{getMe.mockReturnValueOnce({id:request.userId});expect(controller.getMe(request)).toEqual({id:request.userId});expect(getMe).toHaveBeenCalledWith(request.userId);});
 it('validates profile updates before persisting under the caller identity',()=>{const body={displayName:'Maki',bio:null,visibility:'private'};const input={displayName:'Maki',bio:null,visibility:'private'};validateProfileInput.mockReturnValueOnce(input);updateMyProfile.mockReturnValueOnce({displayName:'Maki'});expect(controller.updateProfile(request,body)).toEqual({displayName:'Maki'});expect(validateProfileInput).toHaveBeenCalledWith(body);expect(updateMyProfile).toHaveBeenCalledWith(request.userId,input);});
});
