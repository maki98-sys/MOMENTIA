import { BadRequestException } from '@nestjs/common';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';

describe('SpacesController', () => {
  const spaces = {
    create: jest.fn(),
    listMine: jest.fn(),
    getMine: jest.fn(),
    createInvitation: jest.fn(),
    acceptInvitation: jest.fn(),
  } as unknown as SpacesService;
  const controller = new SpacesController(spaces);

  beforeEach(() => jest.clearAllMocks());

  it('validates and creates an event with timezone defaults', async () => {
    (spaces.create as jest.Mock).mockResolvedValue({ id: 'space-1' });
    await controller.create({ userId: 'user-1' } as never, {
      type: 'EVENT', name: '  Birthday  ', startsAt: '2026-12-01T18:00:00Z',
    });
    expect(spaces.create).toHaveBeenCalledWith('user-1', {
      type: 'EVENT', name: 'Birthday', visibility: 'private',
      startsAt: '2026-12-01T18:00:00Z', endsAt: undefined, timezone: 'UTC',
    });
  });

  it('requires a second user for a couple space', async () => {
    await expect(controller.create({ userId: 'user-1' } as never, {
      type: 'COUPLE', name: 'Us',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid event dates and invalid circle join policies', async () => {
    await expect(controller.create({ userId: 'user-1' } as never, {
      type: 'EVENT', name: 'Event', startsAt: 'not-a-date',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ userId: 'user-1' } as never, {
      type: 'CIRCLE', name: 'Family', joinPolicy: 'open',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unexpected fields and invalid invitation limits', async () => {
    await expect(controller.create({ userId: 'user-1' } as never, {
      type: 'CIRCLE', name: 'Family', ownerId: 'other-user',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.createInvitation(
      { userId: 'user-1' } as never,
      '123e4567-e89b-42d3-a456-426614174000',
      { maxUses: 0 },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects malformed invitation tokens', async () => {
    await expect(controller.acceptInvitation(
      { userId: 'user-1' } as never,
      { token: 'short' },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
