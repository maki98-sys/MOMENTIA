import { NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PostsService } from './posts.service';

function harness() {
  const clientQuery = jest.fn();
  const client = { query: clientQuery };
  const query = jest.fn();
  const transaction = jest.fn(async (operation: (clientArg: never) => Promise<unknown>) =>
    operation(client as never));
  const database = { query, transaction } as unknown as DatabaseService;
  return { service: new PostsService(database), clientQuery, query, transaction };
}

describe('PostsService', () => {
  it('publishes a space post into the space timeline atomically', async () => {
    const h = harness();
    h.clientQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ id: 'post-1', author_id: 'user-1', space_id: 'space-1',
        media_asset_id: null, body: 'Hello', audience: 'space', published_at: '2026-11-18T00:00:00Z' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await h.service.create('user-1', {
      body: 'Hello', mediaAssetId: null, audience: 'space', spaceId: 'space-1',
    });

    expect(result).toMatchObject({ id: 'post-1', audience: 'space', body: 'Hello' });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.clientQuery).toHaveBeenCalledTimes(4);
    expect(h.clientQuery.mock.calls[2][0]).toContain('timeline_entries');
  });

  it('rejects media that is not ready and owned by the author', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(h.service.create('user-1', {
      body: null, mediaAssetId: 'media-1', audience: 'private', spaceId: null,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });

  it('builds a cursor feed that excludes blocked accounts and checks audience access', async () => {
    const h = harness();
    h.query.mockResolvedValue({ rows: [] });
    await expect(h.service.feed('user-1', null)).resolves.toEqual({ posts: [], nextCursor: null });
    expect(h.query.mock.calls[0][0]).toContain('user_blocks');
    expect(h.query.mock.calls[0][0]).toContain("p.audience = 'public'");
    expect(h.query.mock.calls[0][0]).toContain('p.published_at, p.id');
  });
});
