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
  const deviceId = '123e4567-e89b-42d3-a456-426614174000';
  const operationId = '123e4567-e89b-42d3-a456-426614174001';

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
      operationId, type: 'unknown', payload: {},
    }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects unsupported operation properties and oversized operation batches and payloads', async () => {
    await expect(service.push('user-1', { operations: [{
      operationId, type: 'post.create', payload: {}, injected: true,
    }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: Array.from({ length: 51 }, (_, i) => ({
      operationId, type: 'post.create', payload: { i },
    })) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.push('user-1', { operations: [{
      operationId, type: 'post.create', payload: { body: 'x'.repeat(64001) },
    }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('validates pull cursors and positive integer limits before database access', async () => {
    for (const cursor of ['-1', '1.5', '1e2', '1234567890123456789']) {
      await expect(service.pull('user-1', cursor)).rejects.toBeInstanceOf(BadRequestException);
    }
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(service.pull('user-1', undefined, limit)).rejects.toBeInstanceOf(BadRequestException);
    }
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

  it('requires a snapshot when requested change history has expired', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest_sequence: '20', latest_sequence: '90' }] });
    await expect(service.pull('user-1', '3')).resolves.toMatchObject({
      changes: [], nextCursor: '3', hasMore: false, resetRequired: true,
      resetReason: 'history_expired', oldestCursor: '19', serverCursor: '90',
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

  it('keeps the cursor unchanged when there are no changes', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest_sequence: '1', latest_sequence: '8' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.pull('user-1', '8', 20)).resolves.toMatchObject({
      changes: [], nextCursor: '8', hasMore: false, resetRequired: false,
      refreshRequired: false, serverCursor: '8',
    });
  });

  it('marks a full pull page as having more changes', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest_sequence: '1', latest_sequence: '4' }] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [
        { sequence_id: '2', entity_type: 'post', entity_id: 'p1', change_type: 'created', occurred_at: new Date(0) },
        { sequence_id: '3', entity_type: 'post', entity_id: 'p2', change_type: 'created', occurred_at: new Date(1) },
      ] });
    await expect(service.pull('user-1', '1', 2)).resolves.toMatchObject({
      nextCursor: '3', hasMore: true, resetRequired: false, refreshRequired: true,
    });
  });

  it('replays a successful push receipt for an identical idempotency key and payload', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // receipt already exists
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        operation_type: 'post.create', state: 'succeeded', result: { postId: 'p1' },
        error_code: null, request_hash: expect.any(String), created_at: new Date(),
      }] });
    // The service compares the persisted fingerprint; use a deterministic receipt row from a prior call.
    const operation = { operationId, type: 'post.create', payload: { body: 'same body' } };
    const fingerprint = require('node:crypto').createHash('sha256')
      .update(JSON.stringify({ type: 'post.create', payload: { body: 'same body' } })).digest('hex');
    clientQuery.mockReset();
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        operation_type: operation.type, state: 'succeeded', result: { postId: 'p1' },
        error_code: null, request_hash: fingerprint, created_at: new Date(),
      }] });
    await expect(service.push('user-1', { operations: [operation] })).resolves.toMatchObject({
      accepted: 1, rejected: 0, results: [{ operationId, state: 'succeeded', replayed: true }],
    });
  });

  it('rejects reuse of an idempotency key with a different request body', async () => {
    clientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        operation_type: 'post.create', state: 'succeeded', result: { postId: 'p1' },
        error_code: null, request_hash: 'different-fingerprint', created_at: new Date(),
      }] });
    await expect(service.push('user-1', { operations: [{
      operationId, type: 'post.create', payload: { body: 'new body' },
    }] })).resolves.toMatchObject({
      accepted: 0, rejected: 1, results: [{ operationId, state: 'rejected', errorCode: 'IDEMPOTENCY_KEY_REUSED' }],
    });
  });

  it('releases only the snapshot owned by the authenticated user and reports missing snapshots', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'snapshot-1' }] });
    await expect(service.releaseSnapshot('user-1', deviceId)).resolves.toEqual({ released: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('id=$1 AND user_id=$2 RETURNING id'), [deviceId, 'user-1']);
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.releaseSnapshot('user-1', deviceId)).resolves.toEqual({ released: false });
    await expect(service.releaseSnapshot('user-1', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates checkpoint ownership fields before starting a transaction', async () => {
    await expect(service.saveCheckpoint('user-1', { cursor: '4' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveCheckpoint('user-1', { deviceId: 'not-a-uuid', cursor: '4' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '-1' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '4', injected: true }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('persists a checkpoint only for an active device and never advances beyond the server cursor', async () => {
    clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: deviceId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ value: '8' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ device_id: deviceId, last_sequence_id: '5' }] });
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '5' })).resolves.toMatchObject({
      device_id: deviceId, last_sequence_id: '5',
    });
    expect(clientQuery).toHaveBeenCalledTimes(3);
    expect(clientQuery.mock.calls[2][0]).toContain('GREATEST(sync_device_cursors.last_sequence_id,EXCLUDED.last_sequence_id)');
    expect(clientQuery.mock.calls[2][1]).toEqual([deviceId, 'user-1', '5']);

    clientQuery.mockReset();
    clientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: deviceId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ value: '4' }] });
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '5' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('rejects revoked or foreign devices and checkpoint ownership conflicts', async () => {
    clientQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '0' }))
      .rejects.toBeInstanceOf(BadRequestException);

    clientQuery.mockReset();
    clientQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: deviceId }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ value: '4' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.saveCheckpoint('user-1', { deviceId, cursor: '2' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports healthy device sync status and recommends a snapshot for expired history', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: deviceId, platform: 'ios', last_seen_at: new Date(0), revoked_at: null,
      device_cursor: '8', oldest_sequence: '3', latest_sequence: '9',
    }] });
    await expect(service.getDeviceSyncStatus('user-1', deviceId)).resolves.toMatchObject({
      deviceId, platform: 'ios', cursor: '8', oldestCursor: '2', serverCursor: '9',
      resetRequired: false, resetReason: null, recommendedAction: 'pull',
    });

    query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: deviceId, platform: 'android', last_seen_at: new Date(0), revoked_at: null,
      device_cursor: '1', oldest_sequence: '5', latest_sequence: '9',
    }] });
    await expect(service.getDeviceSyncStatus('user-1', deviceId)).resolves.toMatchObject({
      resetRequired: true, resetReason: 'history_expired', recommendedAction: 'snapshot',
    });
  });

  it('rejects missing or revoked devices when reading sync status', async () => {
    query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.getDeviceSyncStatus('user-1', deviceId)).rejects.toBeInstanceOf(BadRequestException);
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: deviceId, platform: 'android', revoked_at: new Date(), device_cursor: '0',
      oldest_sequence: '0', latest_sequence: '0',
    }] });
    await expect(service.getDeviceSyncStatus('user-1', deviceId)).rejects.toBeInstanceOf(BadRequestException);
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
