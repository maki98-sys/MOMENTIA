import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';

describe('NotificationsService', () => {
  const query = jest.fn();
  const service = new NotificationsService({ query } as unknown as DatabaseService);

  beforeEach(() => query.mockReset());

  it('caps page size and returns an unread count', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111', created_at: '2026-11-18T00:00:00.000Z' }] });
    query.mockResolvedValueOnce({ rows: [{ count: 4 }] });

    const result = await service.list('user-1', undefined, 500);

    expect(query.mock.calls[0][1]).toEqual(['user-1', null, null, false, 100]);
    expect(result.unreadCount).toBe(4);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeTruthy();
  });

  it('rejects invalid cursors before querying', async () => {
    await expect(service.list('user-1', 'not-a-date')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed notification ids before querying', async () => {
    await expect(service.markRead('user-1', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not expose another user notification', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.markRead('user-1', '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][1]).toEqual(['11111111-1111-4111-8111-111111111111', 'user-1']);
  });

  it('marks all unread notifications for the authenticated user only', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updated: 3 });
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });
});
