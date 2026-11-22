import { BadRequestException } from '@nestjs/common';
import type { DatabaseService } from '../database/database.service';
import { SyncService } from './sync.service';

describe('SyncService', () => {
  const query = jest.fn();
  const clientQuery = jest.fn();
  const transaction = jest.fn();
  const db = { query, transaction } as unknown as DatabaseService;
  const service = new SyncService(db);
  const client = { query: clientQuery };

  beforeEach(() => {
    query.mockReset();
    clientQuery.mockReset();
    transaction.mockReset();
    transaction.mockImplementation(async (work: (connection: typeof client) => unknown) => work(client));
  });

  it('rejects malformed push envelopes before opening a transaction', async () => {
    await expect(service.push('user-1', null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: [] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: [{ operationId: 'bad', type: 'post.create', payload: {} }] }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: [{
      operationId: '123e4567-e89b-42d3-a456-426614174000', type: 'unknown', payload: {},
    }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported operation properties and oversized operation batches', async () => {
    await expect(service.push('user-1', { operations: [{
      operationId: '123e4567-e89b-42d3-a456-426614174000', type: 'post.create',
      payload: {}, injected: true,
    }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: Array.from({ length: 51 }, (_, i) => ({
      operationId: '123e4567-e89b-42d3-a456-426614174000', type: 'post.create', payload: { i },
    })) })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('validates pull cursors and positive integer limits before database access', async () => {
    await expect(service.pull('user-1', '-1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.pull('user-1', '1.5')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.pull('user-1', undefined, 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.pull('user-1', undefined, 1.5)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requests a fresh snapshot when the client cursor is ahead of the server', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest_sequence: '3', latest_sequence: '9' }] });
    const result = await service.pull('user-1', '12');
    expect(result).toMatchObject({
      changes: [], nextCursor: '12', hasMore: false, resetRequired: true,
      resetReason: 'cursor_ahead', oldestCursor: '2', serverCursor: '9',
    });
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('does not expose change-log payloads and caps pull page size at 500', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest_sequence: '1', latest_sequence: '700' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        sequence_id: '6', entity_type: 'post', entity_id: 'post-1',
        change_type: 'created', occurred_at: new Date(0), payload: { private: true },
      }] });
    const result = await service.pull('user-1', '5', 900);
    expect(clientQuery).toHaveBeenNthCalledWith(3, expect.any(String), ['user-1', '5', 500]);
    expect(result).toMatchObject({
      nextCursor: '6', hasMore: false, resetRequired: false, refreshRequired: true,
      changes: [{ sequence_id: '6', payload: null }],
    });
  });

  it('releases only the snapshot owned by the authenticated user', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'snapshot-1' }] });
    await expect(service.releaseSnapshot('user-1', '123e4567-e89b-42d3-a456-426614174000'))
      .resolves.toEqual({ released: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('id=$1 AND user_id=$2 RETURNING id'), [
      '123e4567-e89b-42d3-a456-426614174000', 'user-1',
    ]);
    await expect(service.releaseSnapshot('user-1', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates checkpoint ownership fields before starting a transaction', async () => {
    await expect(service.saveCheckpoint('user-1', { cursor: '4' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveCheckpoint('user-1', {
      deviceId: 'not-a-uuid', cursor: '4',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveCheckpoint('user-1', {
      deviceId: '123e4567-e89b-42d3-a456-426614174000', cursor: '-1',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid snapshot input and section names', async () => {
    clientQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(service.snapshot('user-1', null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.snapshot('user-1', { sections: ['unknown'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid device IDs before querying sync status', async () => {
    await expect(service.getDeviceSyncStatus('user-1', 'bad-device')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
});
