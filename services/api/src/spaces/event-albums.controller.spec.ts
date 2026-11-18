import { BadRequestException } from '@nestjs/common';
import { EventAlbumsController } from './event-albums.controller';
import { EventAlbumsService } from './event-albums.service';

describe('EventAlbumsController', () => {
  const albums = {
    create: jest.fn(),
    list: jest.fn(),
    listItems: jest.fn(),
    addMedia: jest.fn(),
    removeMedia: jest.fn(),
  } as unknown as EventAlbumsService;
  const controller = new EventAlbumsController(albums);

  beforeEach(() => jest.clearAllMocks());

  it('creates an album with captured-time ordering by default', async () => {
    (albums.create as jest.Mock).mockResolvedValue({ id: 'album-1' });
    await controller.create(
      { userId: 'user-1' } as never,
      '123e4567-e89b-42d3-a456-426614174000',
      { title: 'Wedding' },
    );
    expect(albums.create).toHaveBeenCalledWith(
      'user-1', '123e4567-e89b-42d3-a456-426614174000', 'Wedding', 'captured_at',
    );
  });

  it('rejects invalid titles, sorting modes and extra fields', async () => {
    const spaceId = '123e4567-e89b-42d3-a456-426614174000';
    await expect(controller.create({ userId: 'user-1' } as never, spaceId, { title: ' ' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ userId: 'user-1' } as never, spaceId, {
      title: 'Wedding', sortMode: 'random',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ userId: 'user-1' } as never, spaceId, {
      title: 'Wedding', createdBy: 'attacker',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a valid media asset UUID', async () => {
    await expect(controller.addMedia(
      { userId: 'user-1' } as never,
      '123e4567-e89b-42d3-a456-426614174000',
      { mediaAssetId: 'not-a-uuid' },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
