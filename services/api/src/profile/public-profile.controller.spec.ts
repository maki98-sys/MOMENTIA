import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { ProfileService } from './profile.service';
jest.mock('../auth/oidc-bearer.guard',()=>({OidcBearerGuard:class OidcBearerGuard{}}));
import { PublicProfileController } from './public-profile.controller';

describe('PublicProfileController',()=>{
 const getPublicProfile=jest.fn();
 const service={getPublicProfile} as unknown as ProfileService;
 const controller=new PublicProfileController(service);
 const req={userId:'viewer-1'} as Request&AuthenticatedRequest;
 beforeEach(()=>getPublicProfile.mockReset());
 it('loads the requested public profile in the authenticated viewer context',()=>{
  getPublicProfile.mockReturnValueOnce({userId:'profile-1'});
  expect(controller.getProfile(req,'profile-1')).toEqual({userId:'profile-1'});
  expect(getPublicProfile).toHaveBeenCalledWith('viewer-1','profile-1');
 });
});
