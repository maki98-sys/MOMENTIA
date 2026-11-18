import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConnectionsService } from './connections.service';

describe('ConnectionsService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn(async (operation: (txClient: typeof client) => Promise<unknown>) => operation(client)),
  } as unknown as DatabaseService;
  const service = new ConnectionsService(database);
  const userId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    jest.clearAllMocks();
    (database.transaction as jest.Mock).mockImplementation(
      async (operation: (txClient: typeof client) => Promise<unknown>) => operation(client),
    );
  });

  it('creates a pending request after checking active users and blocks', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: userId }, { id: targetId }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(service.follow(userId, targetId)).resolves.toEqual({ state: 'pending' });
    expect(client.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining("VALUES ($1, $2, 'pending')"), [userId, targetId]);
  });

  it('accepts a reciprocal pending request and creates both accepted directions', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: userId }, { id: targetId }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ requester_id: targetId, target_id: userId, state: 'pending' }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(service.follow(userId, targetId)).resolves.toEqual({ state: 'accepted' });
    expect(client.query).toHaveBeenNthCalledWith(4,
      expect.stringContaining("SET state = 'accepted'"), [targetId, userId]);
    expect(client.query).toHaveBeenNthCalledWith(5,
      expect.stringContaining("VALUES ($1, $2, 'accepted')"), [userId, targetId]);
  });

  it('does not create a relationship when either user has blocked the other', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: userId }, { id: targetId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] });

    await expect(service.follow(userId, targetId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it('rejects self-follow before opening a transaction', async () => {
    await expect(service.follow(userId, userId)).rejects.toBeInstanceOf(BadRequestException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('blocking a user removes both relationship directions in the same transaction', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 2, rows: [{ id: userId }, { id: targetId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] });

    await expect(service.block(userId, targetId)).resolves.toEqual({ success: true });
    expect(client.query).toHaveBeenNthCalledWith(2,
      expect.stringContaining('INSERT INTO user_blocks'), [userId, targetId]);
    expect(client.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('DELETE FROM user_relationships'), [userId, targetId]);
  });
});
