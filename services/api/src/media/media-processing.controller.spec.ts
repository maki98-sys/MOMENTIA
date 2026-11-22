import { UnauthorizedException } from '@nestjs/common';
import { MediaProcessingController } from './media-processing.controller';
import { MediaProcessingService } from './media-processing.service';

describe('MediaProcessingController worker authentication', () => {
  const processing = {
    claim: jest.fn(),
    complete: jest.fn(),
    claimDeletions: jest.fn(),
    completeDeletion: jest.fn(),
    cleanupExpiredUploads: jest.fn(),
    releaseStaleLocks: jest.fn(),
  } as unknown as MediaProcessingService;
  const controller = new MediaProcessingController(processing);
  const token = 'media-worker-secret-'.padEnd(32, 'x');
  const workerId = 'media-worker-01';
  const jobId = '11111111-1111-4111-8111-111111111111';
  const deletionId = '33333333-3333-4333-8333-333333333333';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MEDIA_WORKER_TOKEN = token;
  });

  afterAll(() => {
    delete process.env.MEDIA_WORKER_TOKEN;
  });

  it('rejects requests when the worker secret is not configured', () => {
    delete process.env.MEDIA_WORKER_TOKEN;
    expect(() => controller.claim(token, { workerId })).toThrow(UnauthorizedException);
    expect(processing.claim).not.toHaveBeenCalled();
  });

  it('rejects missing and incorrect worker credentials', () => {
    expect(() => controller.claim(undefined, { workerId })).toThrow(UnauthorizedException);
    expect(() => controller.claim('wrong-worker-secret', { workerId })).toThrow(UnauthorizedException);
    expect(processing.claim).not.toHaveBeenCalled();
  });

  it('requires the shared secret before every internal worker operation', () => {
    const invalid = 'invalid';
    expect(() => controller.complete(invalid, jobId, { workerId, success: true })).toThrow(UnauthorizedException);
    expect(() => controller.claimDeletions(invalid, { workerId })).toThrow(UnauthorizedException);
    expect(() => controller.completeDeletion(invalid, deletionId, { workerId, success: true })).toThrow(UnauthorizedException);
    expect(() => controller.cleanupExpiredUploads(invalid, {})).toThrow(UnauthorizedException);
    expect(() => controller.recover(invalid, {})).toThrow(UnauthorizedException);
    expect(processing.complete).not.toHaveBeenCalled();
    expect(processing.claimDeletions).not.toHaveBeenCalled();
    expect(processing.completeDeletion).not.toHaveBeenCalled();
    expect(processing.cleanupExpiredUploads).not.toHaveBeenCalled();
    expect(processing.releaseStaleLocks).not.toHaveBeenCalled();
  });

  it('accepts an authenticated bounded claim and delegates to the service', () => {
    (processing.claim as jest.Mock).mockReturnValue([{ id: jobId }]);
    expect(controller.claim(token, { workerId, limit: 5 })).toEqual([{ id: jobId }]);
    expect(processing.claim).toHaveBeenCalledWith(workerId, 5);
  });

  it('rejects unexpected claim fields even with valid credentials', () => {
    expect(() => controller.claim(token, { workerId, limit: 5, userId: 'attacker' }))
      .toThrow(UnauthorizedException);
    expect(processing.claim).not.toHaveBeenCalled();
  });
});
