import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { AlbumsService } from './albums.service';

jest.mock('../auth/oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { AlbumsController } from './albums.controller';

describe('AlbumsController', () => {
  const list = jest.fn();
  const create = jest.fn();
  const listItems = jest.fn();
  const addItem = jest.fn();
  const removeItem = jest.fn();
  const service = { list, create, listItems, addItem, removeItem } as unknown as AlbumsService;
  const controller = new AlbumsController(service);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;

  beforeEach(() => {
    for (const mock of [list, create, listItems, addItem, removeItem]) mock.mockReset();
  });

  it('lists albums within the authenticated user and space scope', () => {
    list.mockReturnValueOnce([{ id: 'album-1' }]);
    expect(controller.list(request, 'space-1')).toEqual([{ id: 'album-1' }]);
    expect(list).toHaveBeenCalledWith(request.userId, 'space-1');
  });

  it('creates an album with the caller identity and request body', () => {
    const body = { name: 'Trip photos', visibility: 'members' };
    create.mockReturnValueOnce({ id: 'album-1' });
    expect(controller.create(request, 'space-1', body)).toEqual({ id: 'album-1' });
    expect(create).toHaveBeenCalledWith(request.userId, 'space-1', body);
  });

  it('lists album items with default pagination', () => {
    listItems.mockReturnValueOnce({ items: [], nextCursor: null });
    expect(controller.listItems(request, 'space-1', 'album-1')).toEqual({ items: [], nextCursor: null });
    expect(listItems).toHaveBeenCalledWith(request.userId, 'space-1', 'album-1', undefined, undefined, 30);
  });

  it('forwards item cursor and parsed page size', () => {
    listItems.mockReturnValueOnce({ items: [], nextCursor: null });
    controller.listItems(request, 'space-1', 'album-1', '2026-01-01T00:00:00.000Z', '123e4567-e89b-42d3-a456-426614174000', '80');
    expect(listItems).toHaveBeenCalledWith(
      request.userId,
      'space-1',
      'album-1',
      '2026-01-01T00:00:00.000Z',
      '123e4567-e89b-42d3-a456-426614174000',
      80,
    );
  });

  it('adds an item using the authenticated user, space, album and body', () => {
    const body = { mediaAssetId: 'asset-1', caption: 'At the event' };
    addItem.mockReturnValueOnce({ id: 'item-1' });
    expect(controller.add(request, 'space-1', 'album-1', body)).toEqual({ id: 'item-1' });
    expect(addItem).toHaveBeenCalledWith(request.userId, 'space-1', 'album-1', body);
  });

  it('removes the requested item within the authenticated user scope', () => {
    removeItem.mockReturnValueOnce({ removed: true });
    expect(controller.remove(request, 'space-1', 'album-1', 'item-1')).toEqual({ removed: true });
    expect(removeItem).toHaveBeenCalledWith(request.userId, 'space-1', 'album-1', 'item-1');
  });
});
