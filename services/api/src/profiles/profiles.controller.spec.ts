import { BadRequestException } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

describe('ProfilesController', () => {
  const profiles = {
    findMine: jest.fn(),
    updateMine: jest.fn(),
  } as unknown as ProfilesService;
  const controller = new ProfilesController(profiles);

  beforeEach(() => jest.clearAllMocks());

  it('returns the profile belonging to the authenticated user', async () => {
    (profiles.findMine as jest.Mock).mockResolvedValue(null);
    await expect(controller.findMine({ userId: 'user-1' } as never)).resolves.toEqual({ profile: null });
    expect(profiles.findMine).toHaveBeenCalledWith('user-1');
  });

  it('normalizes and saves profile input with private visibility as default', async () => {
    (profiles.updateMine as jest.Mock).mockResolvedValue({ userId: 'user-1' });
    await controller.updateMine(
      { userId: 'user-1' } as never,
      { displayName: '  Momentia  ', bio: '  hello  ' },
    );
    expect(profiles.updateMine).toHaveBeenCalledWith('user-1', {
      displayName: 'Momentia',
      bio: 'hello',
      visibility: 'private',
    });
  });

  it('rejects unexpected fields rather than silently accepting them', async () => {
    await expect(controller.updateMine(
      { userId: 'user-1' } as never,
      { displayName: 'Momentia', isAdmin: true },
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(profiles.updateMine).not.toHaveBeenCalled();
  });

  it('rejects invalid display names and visibility values', async () => {
    await expect(controller.updateMine(
      { userId: 'user-1' } as never,
      { displayName: '   ' },
    )).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.updateMine(
      { userId: 'user-1' } as never,
      { displayName: 'Momentia', visibility: 'everyone' },
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires authenticated user context', async () => {
    await expect(controller.findMine({} as never)).rejects.toBeInstanceOf(Error);
  });
});
