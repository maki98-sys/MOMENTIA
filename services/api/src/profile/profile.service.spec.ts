import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  const query = jest.fn();
  const database = { query } as unknown as DatabaseService;
  const service = new ProfileService(database);

  beforeEach(() => query.mockReset());

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

  it('upserts a profile only for an active account', async () => {
    query.mockResolvedValueOnce({ rows: [{
      display_name: 'Ana', bio: null, visibility: 'private',
    }] });
    await expect(service.updateMyProfile('user-1', {
      displayName: 'Ana', bio: null, visibility: 'private',
    })).resolves.toEqual({ displayName: 'Ana', bio: null, visibility: 'private' });
    expect(query.mock.calls[0][0]).toContain("status = 'active'");
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (user_id) DO UPDATE');
  });

  it('rejects profile updates for inactive accounts', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.updateMyProfile('user-2', {
      displayName: 'Ana', bio: null, visibility: 'private',
    })).rejects.toBeInstanceOf(NotFoundException);
  });
});
