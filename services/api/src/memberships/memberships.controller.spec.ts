import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { MembershipsService } from './memberships.service';

jest.mock('../auth/oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { MembershipsController } from './memberships.controller';

describe('MembershipsController', () => {
  const list = jest.fn();
  const changeRole = jest.fn();
  const remove = jest.fn();
  const transferOwnership = jest.fn();
  const leave = jest.fn();
  const service = { list, changeRole, remove, transferOwnership, leave } as unknown as MembershipsService;
  const controller = new MembershipsController(service);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;
  const spaceId = 'space-1';

  beforeEach(() => {
    for (const mock of [list, changeRole, remove, transferOwnership, leave]) mock.mockReset();
  });

  it('lists members within the requested space and authenticated user scope', () => {
    list.mockReturnValueOnce([{ userId: 'member-1' }]);
    expect(controller.list(request, spaceId)).toEqual([{ userId: 'member-1' }]);
    expect(list).toHaveBeenCalledWith(request.userId, spaceId);
  });

  it('forwards role changes with caller, space, target and requested role', () => {
    const body = { role: 'moderator' };
    changeRole.mockReturnValueOnce({ updated: true });
    expect(controller.changeRole(request, spaceId, 'member-2', body)).toEqual({ updated: true });
    expect(changeRole).toHaveBeenCalledWith(request.userId, spaceId, 'member-2', 'moderator');
  });

  it('forwards member removal with caller, space and target', () => {
    remove.mockReturnValueOnce({ removed: true });
    expect(controller.remove(request, spaceId, 'member-3')).toEqual({ removed: true });
    expect(remove).toHaveBeenCalledWith(request.userId, spaceId, 'member-3');
  });

  it('forwards a string ownership target and rejects non-string targets at the controller boundary', () => {
    transferOwnership.mockReturnValueOnce({ transferred: true });
    expect(controller.transferOwnership(request, spaceId, { targetUserId: 'member-4' })).toEqual({ transferred: true });
    expect(transferOwnership).toHaveBeenLastCalledWith(request.userId, spaceId, 'member-4');

    transferOwnership.mockReturnValueOnce({ transferred: false });
    expect(controller.transferOwnership(request, spaceId, { targetUserId: 42 })).toEqual({ transferred: false });
    expect(transferOwnership).toHaveBeenLastCalledWith(request.userId, spaceId, '');
  });

  it('allows the authenticated user to request leaving the specified space', () => {
    leave.mockReturnValueOnce({ left: true });
    expect(controller.leave(request, spaceId)).toEqual({ left: true });
    expect(leave).toHaveBeenCalledWith(request.userId, spaceId);
  });
});
