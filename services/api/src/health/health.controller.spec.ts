import { ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const ping = jest.fn();
  const controller = new HealthController({ ping } as unknown as DatabaseService);

  beforeEach(() => {
    ping.mockReset();
  });

  it('reports liveness without querying dependencies', () => {
    expect(controller.live()).toEqual({
      status: 'ok',
      service: 'momentia-api',
    });
    expect(ping).not.toHaveBeenCalled();
  });

  it('reports readiness only after PostgreSQL responds', async () => {
    ping.mockResolvedValueOnce(undefined);

    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      dependencies: { postgres: 'ok' },
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('returns service unavailable when PostgreSQL cannot be reached', async () => {
    ping.mockRejectedValueOnce(new Error('connection refused'));

    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(
      controller.ready().catch((error: unknown) => {
        if (!(error instanceof ServiceUnavailableException)) throw error;
        return error.getResponse();
      }),
    ).resolves.toEqual({
      statusCode: 503,
      message: {
        status: 'not_ready',
        dependencies: { postgres: 'unavailable' },
      },
    });
    expect(ping).toHaveBeenCalledTimes(2);
  });
});
