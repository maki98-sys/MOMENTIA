jest.mock('../auth/oidc-bearer.guard', () => ({
  OidcBearerGuard: class OidcBearerGuard {},
}));

import { BadRequestException } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

describe('PostsController', () => {
  const posts = {
    create: jest.fn(),
    feed: jest.fn(),
    get: jest.fn(),
    addComment: jest.fn(),
    listComments: jest.fn(),
    setReaction: jest.fn(),
    removeReaction: jest.fn(),
  } as unknown as PostsService;
  const controller = new PostsController(posts);

  beforeEach(() => jest.clearAllMocks());

  it('creates a private post by default and normalizes text', async () => {
    (posts.create as jest.Mock).mockResolvedValue({ id: 'post-1' });
    await controller.create({ userId: 'user-1' } as never, { body: '  Hello  ' });
    expect(posts.create).toHaveBeenCalledWith('user-1', {
      body: 'Hello', mediaAssetId: null, audience: 'private', spaceId: null,
    });
  });

  it('requires a space ID only for space-audience posts', async () => {
    await expect(controller.create({ userId: 'user-1' } as never, {
      body: 'Hello', audience: 'space',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ userId: 'user-1' } as never, {
      body: 'Hello', audience: 'public', spaceId: '123e4567-e89b-42d3-a456-426614174000',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty posts and unknown audience values', async () => {
    await expect(controller.create({ userId: 'user-1' } as never, { body: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.create({ userId: 'user-1' } as never, {
      body: 'Hello', audience: 'world',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid reactions and malformed cursors', async () => {
    const postId = '123e4567-e89b-42d3-a456-426614174000';
    await expect(controller.setReaction({ userId: 'user-1' } as never, postId, {
      reaction: 'angry',
    })).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.feed({ userId: 'user-1' } as never, 'bad-cursor'))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
