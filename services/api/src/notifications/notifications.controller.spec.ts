import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const list = jest.fn();
  const markRead = jest.fn();
  const markAllRead = jest.fn();
  const listPreferences = jest.fn();
  const setPreference = jest.fn();
  const controller = new NotificationsController({
    list,
    markRead,
    markAllRead,
    listPreferences,
    setPreference,
  } as unknown as NotificationsService);
  const request = { userId: '11111111-1111-4111-8111-111111111111' } as Request & AuthenticatedRequest;

  beforeEach(() => {
    list.mockReset();
    markRead.mockReset();
    markAllRead.mockReset();
    listPreferences.mockReset();
    setPreference.mockReset();
  });

  it('applies safe list defaults and forwards validated filters', () => {
    controller.list(request);
    expect(list).toHaveBeenLastCalledWith(request.userId, undefined, 30, false);
    controller.list(request, 'cursor-1', '50', 'true');
    expect(list).toHaveBeenLastCalledWith(request.userId, 'cursor-1', 50, true);
  });

  it('rejects malformed, fractional, zero, and oversized page limits', () => {
    for (const limit of ['abc', '1.5', '0', '101', '1234']) {
      expect(() => controller.list(request, undefined, limit)).toThrow(BadRequestException);
    }
    expect(list).not.toHaveBeenCalled();
  });

  it('requires unreadOnly to be a boolean string', () => {
    expect(() => controller.list(request, undefined, undefined, 'yes')).toThrow(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });

  it('scopes notification mutations and preference operations to the authenticated user', () => {
    controller.markRead(request, 'notification-1');
    controller.markAllRead(request);
    controller.listPreferences(request);
    controller.setPreference(request, 'social', { enabled: false });
    expect(markRead).toHaveBeenCalledWith(request.userId, 'notification-1');
    expect(markAllRead).toHaveBeenCalledWith(request.userId);
    expect(listPreferences).toHaveBeenCalledWith(request.userId);
    expect(setPreference).toHaveBeenCalledWith(request.userId, 'social', { enabled: false });
  });
});
