import { UnauthorizedException } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { AccountDeletionWorkerController } from './account-deletion-worker.controller';

describe('AccountDeletionWorkerController', () => {
  const claimDueDeletionRequests = jest.fn();
  const completeDeletionRequest = jest.fn();
  const controller = new AccountDeletionWorkerController(
    { claimDueDeletionRequests, completeDeletionRequest } as unknown as PrivacyService,
  );
  const previousToken = process.env.ACCOUNT_DELETION_WORKER_TOKEN;

  beforeEach(() => {
    claimDueDeletionRequests.mockReset();
    completeDeletionRequest.mockReset();
    process.env.ACCOUNT_DELETION_WORKER_TOKEN = 'account-deletion-worker-secret';
  });

  afterAll(() => {
    if (previousToken === undefined) delete process.env.ACCOUNT_DELETION_WORKER_TOKEN;
    else process.env.ACCOUNT_DELETION_WORKER_TOKEN = previousToken;
  });

  it('rejects missing, incorrect, or unconfigured worker credentials', () => {
    expect(() => controller.claim(undefined, { workerId: 'worker-01' })).toThrow(UnauthorizedException);
    expect(() => controller.claim('incorrect', { workerId: 'worker-01' })).toThrow(UnauthorizedException);
    delete process.env.ACCOUNT_DELETION_WORKER_TOKEN;
    expect(() => controller.claim('account-deletion-worker-secret', { workerId: 'worker-01' }))
      .toThrow(UnauthorizedException);
    expect(claimDueDeletionRequests).not.toHaveBeenCalled();
  });

  it('claims deletion work with a validated worker id and default limit', async () => {
    claimDueDeletionRequests.mockResolvedValueOnce([]);
    await expect(controller.claim('account-deletion-worker-secret', { workerId: 'worker-01' })).resolves.toEqual([]);
    expect(claimDueDeletionRequests).toHaveBeenCalledWith('worker-01', 10);
  });

  it('rejects malformed claim payloads and unsafe limits', () => {
    const token = 'account-deletion-worker-secret';
    expect(() => controller.claim(token, null)).toThrow(UnauthorizedException);
    expect(() => controller.claim(token, { workerId: 'x' })).toThrow(UnauthorizedException);
    expect(() => controller.claim(token, { workerId: 'worker-01', limit: 51 })).toThrow(UnauthorizedException);
    expect(() => controller.claim(token, { workerId: 'worker-01', extra: true })).toThrow(UnauthorizedException);
    expect(claimDueDeletionRequests).not.toHaveBeenCalled();
  });

  it('completes a deletion request using only the supplied worker result', async () => {
    completeDeletionRequest.mockResolvedValueOnce({ status: 'completed' });
    await expect(controller.complete(
      'account-deletion-worker-secret',
      '22222222-2222-4222-8222-222222222222',
      { workerId: 'worker-01', success: true, purged: true },
    )).resolves.toEqual({ status: 'completed' });
    expect(completeDeletionRequest).toHaveBeenCalledWith(
      'worker-01',
      '22222222-2222-4222-8222-222222222222',
      { success: true, purged: true },
    );
  });

  it('rejects completion payloads without a valid worker identity', () => {
    expect(() => controller.complete(
      'account-deletion-worker-secret',
      '22222222-2222-4222-8222-222222222222',
      { workerId: 'x', success: true },
    )).toThrow(UnauthorizedException);
    expect(completeDeletionRequest).not.toHaveBeenCalled();
  });
});
