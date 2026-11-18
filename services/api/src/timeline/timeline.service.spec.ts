import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TimelineService } from './timeline.service';

describe('TimelineService', () => {
  const database = { query: jest.fn() } as unknown as DatabaseService;
  const service = new TimelineService(database);
  const spaceId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => jest.clearAllMocks());

  it('requires active space membership before reading the timeline', async () => {
    (database.query as jest.Mock).mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(service.list(userId, spaceId)).rejects.toBeInstanceOf(NotFoundException);
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('returns a stable cursor and enforces post/media visibility in SQL', async () => {
    const firstAt = new Date('2026-11-18T02:00:00.000Z');
    const secondAt = new Date('2026-11-18T01:00:00.000Z');
    (database.query as jest.Mock)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          {
            id: '33333333-3333-4333-8333-333333333333', source: 'post',
            occurred_at: firstAt, post_id: '44444444-4444-4444-8444-444444444444',
            media_asset_id: null, author_id: userId, display_name: 'Member',
            body: 'A memory', audience: 'space', published_at: firstAt,
            mime_type_detected: null, size_bytes: null, width: null, height: null,
          },
          {
            id: '55555555-5555-4555-8555-555555555555', source: 'upload',
            occurred_at: secondAt, post_id: null, media_asset_id: '66666666-6666-4666-8666-666666666666',
            author_id: null, display_name: null, body: null, audience: null, published_at: null,
            mime_type_detected: 'image/webp', size_bytes: '1024', width: 320, height: 240,
          },
        ],
      });

    const result = await service.list(userId, spaceId, undefined, 1);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      type: 'post', source: 'post', post: { body: 'A memory', authorId: userId },
    });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(database.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('user_blocks'),
      [spaceId, userId, null, null, 2],
    );
    expect((database.query as jest.Mock).mock.calls[1][0]).toContain('media_access_grants');
  });

  it('rejects malformed pagination cursors', async () => {
    await expect(service.list(userId, spaceId, 'not-a-valid-cursor')).rejects.toBeInstanceOf(BadRequestException);
    expect(database.query).not.toHaveBeenCalled();
  });
});
