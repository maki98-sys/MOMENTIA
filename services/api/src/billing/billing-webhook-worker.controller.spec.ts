import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingWebhookWorkerController } from './billing-webhook-worker.controller';

describe('BillingWebhookWorkerController', () => {
  const processBatch = jest.fn();
  const recoverStale = jest.fn();
  const listDeadLetter = jest.fn();
  const retryDeadLetter = jest.fn();
  const get = jest.fn();
  const controller = new BillingWebhookWorkerController(
    { processBatch, recoverStale, listDeadLetter, retryDeadLetter } as unknown as BillingWebhookService,
    { get } as unknown as ConfigService,
  );

  beforeEach(() => {
    processBatch.mockReset();
    recoverStale.mockReset();
    listDeadLetter.mockReset();
    retryDeadLetter.mockReset();
    get.mockReset().mockReturnValue('b'.repeat(32));
  });

  it('rejects missing, incorrect, or unconfigured worker credentials', () => {
    expect(() => controller.process(undefined)).toThrow(UnauthorizedException);
    expect(() => controller.process('wrong')).toThrow(UnauthorizedException);
    get.mockReturnValue(undefined);
    expect(() => controller.process('b'.repeat(32))).toThrow(UnauthorizedException);
    expect(processBatch).not.toHaveBeenCalled();
  });

  it('processes and recovers webhook batches only after authorization', async () => {
    processBatch.mockResolvedValueOnce({ processed: 2 });
    recoverStale.mockResolvedValueOnce({ recovered: 1 });
    await expect(controller.process('b'.repeat(32))).resolves.toEqual({ processed: 2 });
    await expect(controller.recover('b'.repeat(32))).resolves.toEqual({ recovered: 1 });
    expect(processBatch).toHaveBeenCalledWith(30);
    expect(recoverStale).toHaveBeenCalledWith(300);
  });

  it('accepts numeric dead-letter limits and rejects malformed or out-of-range values', async () => {
    listDeadLetter.mockResolvedValueOnce([]);
    await expect(controller.deadLetter('b'.repeat(32), '25')).resolves.toEqual([]);
    expect(listDeadLetter).toHaveBeenCalledWith(25);
    expect(() => controller.deadLetter('b'.repeat(32), 'abc')).toThrow(UnauthorizedException);
    expect(() => controller.deadLetter('b'.repeat(32), '101')).toThrow(UnauthorizedException);
    expect(listDeadLetter).toHaveBeenCalledTimes(1);
  });

  it('requires authorization before retrying a dead-letter event', async () => {
    retryDeadLetter.mockResolvedValueOnce({ retried: true });
    await expect(controller.retry('b'.repeat(32), 'event-123')).resolves.toEqual({ retried: true });
    expect(retryDeadLetter).toHaveBeenCalledWith('event-123');
    expect(() => controller.retry('invalid', 'event-123')).toThrow(UnauthorizedException);
  });
});
