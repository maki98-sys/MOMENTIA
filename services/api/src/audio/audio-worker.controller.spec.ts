import { UnauthorizedException } from '@nestjs/common';
import { AudioService } from './audio.service';
import { AudioWorkerController } from './audio-worker.controller';

describe('AudioWorkerController', () => {
  const cleanupStaleParticipants = jest.fn();
  const controller = new AudioWorkerController(
    { cleanupStaleParticipants } as unknown as AudioService,
  );
  const previousToken = process.env.AUDIO_WORKER_TOKEN;

  beforeEach(() => {
    cleanupStaleParticipants.mockReset();
    process.env.AUDIO_WORKER_TOKEN = 'audio-worker-secret-0123456789';
  });

  afterAll(() => {
    if (previousToken === undefined) delete process.env.AUDIO_WORKER_TOKEN;
    else process.env.AUDIO_WORKER_TOKEN = previousToken;
  });

  it('rejects missing, incorrect, or unconfigured credentials', () => {
    expect(() => controller.cleanup(undefined, {})).toThrow(UnauthorizedException);
    expect(() => controller.cleanup('wrong', {})).toThrow(UnauthorizedException);
    delete process.env.AUDIO_WORKER_TOKEN;
    expect(() => controller.cleanup('audio-worker-secret-0123456789', {})).toThrow(UnauthorizedException);
    expect(cleanupStaleParticipants).not.toHaveBeenCalled();
  });

  it('cleans stale participants using the default timeout', async () => {
    cleanupStaleParticipants.mockResolvedValueOnce(['session-1']);
    const result = await controller.cleanup('audio-worker-secret-0123456789', {});
    expect(result).toMatchObject({
      staleAfterSeconds: 45,
      affectedSessionIds: ['session-1'],
      affectedCount: 1,
    });
    expect(result.processedAt).toEqual(expect.any(String));
    expect(cleanupStaleParticipants).toHaveBeenCalledWith(45);
  });

  it('accepts an explicit timeout in the permitted range', async () => {
    cleanupStaleParticipants.mockResolvedValueOnce([]);
    const result = await controller.cleanup('audio-worker-secret-0123456789', { staleAfterSeconds: 300 });
    expect(result.staleAfterSeconds).toBe(300);
    expect(cleanupStaleParticipants).toHaveBeenCalledWith(300);
  });

  it('rejects unsupported, malformed, and out-of-range cleanup payloads', () => {
    const token = 'audio-worker-secret-0123456789';
    expect(() => controller.cleanup(token, [])).toThrow(UnauthorizedException);
    expect(() => controller.cleanup(token, { staleAfterSeconds: 10 })).toThrow(UnauthorizedException);
    expect(() => controller.cleanup(token, { staleAfterSeconds: 3601 })).toThrow(UnauthorizedException);
    expect(() => controller.cleanup(token, { staleAfterSeconds: 60, force: true })).toThrow(UnauthorizedException);
    expect(cleanupStaleParticipants).not.toHaveBeenCalled();
  });
});
