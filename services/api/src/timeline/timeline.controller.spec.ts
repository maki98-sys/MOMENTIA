import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { TimelineService } from './timeline.service';

jest.mock('../auth/oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { TimelineController } from './timeline.controller';

describe('TimelineController', () => {
  const list = jest.fn();
  const add = jest.fn();
  const service = { list, add } as unknown as TimelineService;
  const controller = new TimelineController(service);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;

  beforeEach(() => {
    list.mockReset();
    add.mockReset();
  });

  it('lists timeline entries in the authenticated user and requested space scope', () => {
    list.mockReturnValueOnce([{ id: 'entry-1' }]);
    expect(controller.list(request, 'space-1')).toEqual([{ id: 'entry-1' }]);
    expect(list).toHaveBeenCalledWith(request.userId, 'space-1', undefined, 30, undefined);
  });

  it('forwards cursor, cursorId and a valid page limit', () => {
    list.mockReturnValueOnce([]);
    expect(controller.list(request, 'space-1', '2026-01-01T00:00:00.000Z', '75', '123e4567-e89b-42d3-a456-426614174000')).toEqual([]);
    expect(list).toHaveBeenCalledWith(
      request.userId,
      'space-1',
      '2026-01-01T00:00:00.000Z',
      75,
      '123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it.each([undefined, '0', 'invalid'])('uses the default page size for limit %s', (limit) => {
    controller.list(request, 'space-1', undefined, limit);
    expect(list).toHaveBeenCalledWith(request.userId, 'space-1', undefined, 30, undefined);
  });

  it('adds an entry using only the authenticated user scope and supplied body', () => {
    const body = { mediaAssetId: 'asset-1', source: 'upload' };
    add.mockReturnValueOnce({ id: 'entry-1' });
    expect(controller.add(request, 'space-1', body)).toEqual({ id: 'entry-1' });
    expect(add).toHaveBeenCalledWith(request.userId, 'space-1', body);
  });
});
