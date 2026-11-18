import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';

describe('NotificationsService', () => {
  const query = jest.fn();
  const service = new NotificationsService({ query } as unknown as DatabaseService);

  beforeEach(() => query.mockReset());

  it('caps page size and returns an unread count', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'n1', created_at: '2026-11-18T00:00:00.000Z' }] });
    query.mockResolvedValueOnce({ rows: [{ count: 4 }] });

    const result = await service.list('user-1', undefined, 500);

    expect(query.mock.calls[0][1]).toEqual(['user-1', null, false, 100]);
    expect(result.unreadCount).toBe(4);
    expect(result.items).toHaveLength(1);
  });

  it('rejects invalid cursors before querying', async () => {
    await expect(service.list('user-1', 'not-a-date')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not expose another user notification', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.markRead('user-1', 'n-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][1]).toEqual(['n-other', 'user-1']);
  });

  it('marks all unread notifications for the authenticated user only', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updated: 3 });
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });
});
