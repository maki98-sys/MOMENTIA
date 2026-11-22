import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpacesService } from './spaces.service';
import { EventsWorkerController } from './events-worker.controller';

describe('EventsWorkerController', () => {
  const archiveEndedEvents = jest.fn();
  const enqueueEventReminders = jest.fn();
  const get = jest.fn();
  const controller = new EventsWorkerController(
    { archiveEndedEvents, enqueueEventReminders } as unknown as SpacesService,
    { get } as unknown as ConfigService,
  );

  beforeEach(() => {
    archiveEndedEvents.mockReset();
    enqueueEventReminders.mockReset();
    get.mockReset().mockImplementation((key: string) =>
      key === 'EVENTS_WORKER_TOKEN' ? 'events-worker-secret-0123456789' : 'notification-worker-secret-0123456789',
    );
  });

  it('authorizes event archival with the dedicated event worker token', async () => {
    archiveEndedEvents.mockResolvedValueOnce({ archived: 2 });
    await expect(controller.archiveEnded('events-worker-secret-0123456789')).resolves.toEqual({ archived: 2 });
    expect(archiveEndedEvents).toHaveBeenCalledWith(24);
    expect(() => controller.archiveEnded('notification-worker-secret-0123456789')).toThrow(UnauthorizedException);
  });

  it('authorizes reminder enqueueing with the notification worker token', async () => {
    enqueueEventReminders.mockResolvedValueOnce({ queued: 3 });
    await expect(controller.queueReminders('notification-worker-secret-0123456789')).resolves.toEqual({ queued: 3 });
    expect(enqueueEventReminders).toHaveBeenCalledTimes(1);
    expect(() => controller.queueReminders('events-worker-secret-0123456789')).toThrow(UnauthorizedException);
  });

  it('rejects missing credentials or missing worker secrets', () => {
    expect(() => controller.archiveEnded(undefined)).toThrow(UnauthorizedException);
    get.mockReturnValue(undefined);
    expect(() => controller.queueReminders('notification-worker-secret-0123456789')).toThrow(UnauthorizedException);
    expect(archiveEndedEvents).not.toHaveBeenCalled();
    expect(enqueueEventReminders).not.toHaveBeenCalled();
  });
});
