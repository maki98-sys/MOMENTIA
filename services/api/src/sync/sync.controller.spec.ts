import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';

describe('SyncController', () => {
  const push = jest.fn();
  const snapshot = jest.fn();
  const releaseSnapshot = jest.fn();
  const getDeviceSyncStatus = jest.fn();
  const saveCheckpoint = jest.fn();
  const pull = jest.fn();
  const service = {
    push,
    snapshot,
    releaseSnapshot,
    getDeviceSyncStatus,
    saveCheckpoint,
    pull,
  } as unknown as SyncService;
  const controller = new SyncController(service);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;
  const validEnvelope = {
    operations: [{
      operationId: '123e4567-e89b-42d3-a456-426614174000',
      type: 'post.create',
      payload: { body: 'hello' },
    }],
  };

  beforeEach(() => {
    for (const mock of [push, snapshot, releaseSnapshot, getDeviceSyncStatus, saveCheckpoint, pull]) {
      mock.mockReset();
    }
  });

  it('validates the push envelope before delegating to the authenticated user scope', async () => {
    push.mockResolvedValueOnce({ accepted: 1 });
    await expect(controller.push(request, validEnvelope)).resolves.toEqual({ accepted: 1 });
    expect(push).toHaveBeenCalledWith(request.userId, validEnvelope);
    expect(() => controller.push(request, { ...validEnvelope, userId: 'attacker' })).toThrow(BadRequestException);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('delegates snapshot creation, release and checkpoint to the authenticated user', () => {
    snapshot.mockReturnValueOnce({ id: 'snapshot-1' });
    releaseSnapshot.mockReturnValueOnce({ released: true });
    saveCheckpoint.mockReturnValueOnce({ saved: true });

    expect(controller.snapshot(request, { deviceId: 'device-1' })).toEqual({ id: 'snapshot-1' });
    expect(controller.releaseSnapshot(request, 'snapshot-1')).toEqual({ released: true });
    expect(controller.checkpoint(request, { cursor: 'cursor-1' })).toEqual({ saved: true });
    expect(snapshot).toHaveBeenCalledWith(request.userId, { deviceId: 'device-1' });
    expect(releaseSnapshot).toHaveBeenCalledWith(request.userId, 'snapshot-1');
    expect(saveCheckpoint).toHaveBeenCalledWith(request.userId, { cursor: 'cursor-1' });
  });

  it('requires a deviceId for sync status and scopes status to the caller', () => {
    expect(() => controller.status(request)).toThrow(BadRequestException);
    expect(getDeviceSyncStatus).not.toHaveBeenCalled();

    getDeviceSyncStatus.mockReturnValueOnce({ cursor: 'cursor-1' });
    expect(controller.status(request, 'device-1')).toEqual({ cursor: 'cursor-1' });
    expect(getDeviceSyncStatus).toHaveBeenCalledWith(request.userId, 'device-1');
  });

  it('uses the default pull page size and forwards a valid cursor and limit', () => {
    pull.mockReturnValueOnce([]);
    expect(controller.pull(request)).toEqual([]);
    expect(pull).toHaveBeenLastCalledWith(request.userId, undefined, 200);

    pull.mockReturnValueOnce([{ id: 'change-1' }]);
    expect(controller.pull(request, 'cursor-1', '500')).toEqual([{ id: 'change-1' }]);
    expect(pull).toHaveBeenLastCalledWith(request.userId, 'cursor-1', 500);
  });

  it('rejects malformed, fractional, zero, negative and oversized pull limits before querying', () => {
    for (const limit of ['abc', '1.5', '1e2', '0', '-1', '501', '12345']) {
      expect(() => controller.pull(request, undefined, limit)).toThrow(BadRequestException);
    }
    expect(pull).not.toHaveBeenCalled();
  });
});
