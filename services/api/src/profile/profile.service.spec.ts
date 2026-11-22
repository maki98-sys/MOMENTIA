import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const database = { query, transaction } as unknown as DatabaseService;
  const service = new ProfileService(database);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

  it('returns the authenticated account and nullable profile', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'user-1', email_normalized: 'a@example.test', phone_e164: null,
      status: 'active', created_at: '2026-11-18T00:00:00.000Z',
      display_name: null, bio: null, visibility: null,
    }] });
    await expect(service.getMe('user-1')).resolves.toMatchObject({
      id: 'user-1', email: 'a@example.test', profile: null,
    });
  });

  it('does not return suspended or missing accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.getMe('user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects unknown profile fields and invalid visibility', () => {
    expect(() => service.validateProfileInput({ displayName: 'Ana', visibility: 'public', isAdmin: true }))
      .toThrow(BadRequestException);
    expect(() => service.validateProfileInput({ displayName: 'Ana', bio: null, visibility: 'everyone' }))
      .toThrow(BadRequestException);
  });

  it('normalizes valid profile input', () => {
    expect(service.validateProfileInput({
      displayName: ' Ana ', bio: ' Hola ', visibility: 'private',
    })).toEqual({ displayName: 'Ana', bio: 'Hola', visibility: 'private' });
  });

  it('returns only public profile fields for a public account', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'user-2', display_name: 'Bea', bio: 'Hola', visibility: 'public',
      avatar_media_id: null, viewer_follows: false,
    }] });
    await expect(service.getPublicProfile('viewer-1', 'user-2')).resolves.toEqual({
      id: 'user-2', displayName: 'Bea', bio: 'Hola', avatarMediaId: null,
    });
    expect(query.mock.calls[0][0]).toContain('user_blocks');
    expect(query.mock.calls[0][0]).not.toContain('email_normalized');
  });

  it('hides private profiles from non-followers', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'user-2', display_name: 'Bea', bio: null, visibility: 'private',
      avatar_media_id: null, viewer_follows: false,
    }] });
    await expect(service.getPublicProfile('viewer-1', 'user-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows followers to view followers-only profiles', async () => {
    query.mockResolvedValueOnce({ rows: [{
      id: 'user-2', display_name: 'Bea', bio: null, visibility: 'followers',
      avatar_media_id: null, viewer_follows: true,
    }] });
    await expect(service.getPublicProfile('viewer-1', 'user-2')).resolves.toMatchObject({ id: 'user-2' });
  });

  it('upserts a profile only for an active account', async () => {
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({ rows: [{ display_name: 'Ana', bio: null, visibility: 'private' }],rowCount:1 });
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.updateMyProfile('user-1', {
      displayName: 'Ana', bio: null, visibility: 'private',
    })).resolves.toEqual({ displayName: 'Ana', bio: null, visibility: 'private' });
    expect(clientQuery.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(clientQuery.mock.calls[1][0]).toContain("status = 'active'");
    expect(clientQuery.mock.calls[1][0]).toContain('ON CONFLICT (user_id) DO UPDATE');
  });

  it('rejects profile updates for inactive accounts', async () => {
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({ rows: [],rowCount:0 });
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.updateMyProfile('user-2', {
      displayName: 'Ana', bio: null, visibility: 'private',
    })).rejects.toBeInstanceOf(NotFoundException);
  });
});
