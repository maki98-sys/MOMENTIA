import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsWorkerController } from './notifications-worker.controller';

describe('NotificationsWorkerController', () => {
  const dispatchPushBatch = jest.fn();
  const recoverStalePushDeliveries = jest.fn();
  const get = jest.fn();
  const controller = new NotificationsWorkerController(
    { dispatchPushBatch, recoverStalePushDeliveries } as unknown as NotificationsService,
    { get } as unknown as ConfigService,
  );

  beforeEach(() => {
    dispatchPushBatch.mockReset();
    recoverStalePushDeliveries.mockReset();
    get.mockReset().mockReturnValue('n'.repeat(32));
  });

  it('rejects dispatch when the worker token is missing or incorrect', () => {
    expect(() => controller.dispatch(undefined, {})).toThrow(UnauthorizedException);
    expect(() => controller.dispatch('wrong-token', {})).toThrow(UnauthorizedException);
    expect(dispatchPushBatch).not.toHaveBeenCalled();
  });

  it('rejects dispatch when no worker secret is configured', () => {
    get.mockReturnValue(undefined);
    expect(() => controller.dispatch('n'.repeat(32), {})).toThrow(UnauthorizedException);
    expect(dispatchPushBatch).not.toHaveBeenCalled();
  });

  it('dispatches a bounded batch with the default limit', async () => {
    dispatchPushBatch.mockResolvedValueOnce({ processed: 3 });
    await expect(controller.dispatch('n'.repeat(32), {})).resolves.toEqual({ processed: 3 });
    expect(dispatchPushBatch).toHaveBeenCalledWith(50);
  });

  it('rejects unsupported and out-of-range dispatch payloads', () => {
    expect(() => controller.dispatch('n'.repeat(32), { limit: 5, force: true })).toThrow(UnauthorizedException);
    expect(() => controller.dispatch('n'.repeat(32), { limit: 101 })).toThrow(UnauthorizedException);
    expect(dispatchPushBatch).not.toHaveBeenCalled();
  });

  it('recovers stale deliveries only with a valid bounded request', async () => {
    recoverStalePushDeliveries.mockResolvedValueOnce({ recovered: 2 });
    await expect(controller.recoverStale('n'.repeat(32), { staleAfterSeconds: 300 }))
      .resolves.toEqual({ recovered: 2 });
    expect(recoverStalePushDeliveries).toHaveBeenCalledWith(300);
  });

  it('rejects malformed recovery payloads', () => {
    expect(() => controller.recoverStale('n'.repeat(32), { staleAfterSeconds: 30 })).toThrow(UnauthorizedException);
    expect(() => controller.recoverStale('n'.repeat(32), { staleAfterSeconds: 180, force: true })).toThrow(UnauthorizedException);
    expect(recoverStalePushDeliveries).not.toHaveBeenCalled();
  });
});
