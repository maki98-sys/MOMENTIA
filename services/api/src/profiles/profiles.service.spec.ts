import { DatabaseService } from '../database/database.service';
import { ProfilesService } from './profiles.service';

function createHarness() {
  const query = jest.fn();
  const database = { query } as unknown as DatabaseService;
  return { service: new ProfilesService(database), query };
}

describe('ProfilesService', () => {
  it('returns null when the user has not created a profile yet', async () => {
    const h = createHarness();
    h.query.mockResolvedValue({ rows: [] });

    await expect(h.service.findMine('user-1')).resolves.toBeNull();
    expect(h.query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('maps a stored profile to the public API shape', async () => {
    const h = createHarness();
    h.query.mockResolvedValue({
      rows: [{
        user_id: 'user-1',
        display_name: 'Maki',
        bio: null,
        visibility: 'private',
        created_at: '2026-11-18T00:00:00.000Z',
        updated_at: '2026-11-18T00:00:00.000Z',
      }],
    });

    await expect(h.service.findMine('user-1')).resolves.toEqual({
      userId: 'user-1',
      displayName: 'Maki',
      bio: null,
      visibility: 'private',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
    });
  });

  it('creates or updates only the authenticated user profile', async () => {
    const h = createHarness();
    h.query.mockResolvedValue({
      rows: [{
        user_id: 'user-1',
        display_name: 'Momentia User',
        bio: 'Hello',
        visibility: 'followers',
        created_at: '2026-11-18T00:00:00.000Z',
        updated_at: '2026-11-18T00:01:00.000Z',
      }],
    });

    await h.service.updateMine('user-1', {
      displayName: 'Momentia User',
      bio: 'Hello',
      visibility: 'followers',
    });

    expect(h.query.mock.calls[0][0]).toContain('ON CONFLICT (user_id) DO UPDATE');
    expect(h.query.mock.calls[0][1]).toEqual(['user-1', 'Momentia User', 'Hello', 'followers']);
  });
});
