import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SpacesService } from './spaces.service';

function harness() {
  const clientQuery = jest.fn();
  const client = { query: clientQuery };
  const query = jest.fn();
  const transaction = jest.fn(async (operation: (clientArg: never) => Promise<unknown>) =>
    operation(client as never));
  const database = { query, transaction } as unknown as DatabaseService;
  return { service: new SpacesService(database), clientQuery, query, transaction };
}

describe('SpacesService', () => {
  it('creates a circle, owner membership and audit event atomically', async () => {
    const h = harness();
    h.clientQuery
      .mockResolvedValueOnce({ rows: [{ id: 'space-1', type: 'CIRCLE', name: 'Family',
        visibility: 'private', status: 'active', created_at: '2026-11-18T00:00:00Z' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await h.service.create('user-1', {
      type: 'CIRCLE', name: 'Family', visibility: 'private',
      description: 'Our family', joinPolicy: 'invite',
    });

    expect(result).toMatchObject({ id: 'space-1', type: 'CIRCLE', role: 'owner' });
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.clientQuery).toHaveBeenCalledTimes(4);
    expect(h.clientQuery.mock.calls[2][0]).toContain("'owner', 'active'");
  });

  it('requires an existing active partner before creating a couple', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(h.service.create('user-1', {
      type: 'COUPLE', name: 'Us', visibility: 'private', partnerUserId: 'user-2',
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });

  it('does not let ordinary members mint invitations', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({
      rows: [{ type: 'CIRCLE', status: 'active', role: 'member' }],
    });

    await expect(h.service.createInvitation('user-1', 'space-1', {
      role: 'member', expiresInHours: 72, maxUses: 1,
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });

  it('stores only a SHA-256 invitation token hash and returns the raw token once', async () => {
    const h = harness();
    h.clientQuery
      .mockResolvedValueOnce({ rows: [{ type: 'EVENT', status: 'active', role: 'owner' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'invite-1', expires_at: '2026-11-21T00:00:00Z' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await h.service.createInvitation('user-1', 'space-1', {
      role: 'guest', expiresInHours: 72, maxUses: 1,
    });

    expect(result.token).toHaveLength(43);
    expect(result.invitationId).toBe('invite-1');
    const insertValues = h.clientQuery.mock.calls[1][1] as unknown[];
    expect(insertValues[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(insertValues[2]).not.toBe(result.token);
  });

  it('does not let admins change member roles', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({ rows: [{ status: 'active', role: 'admin' }] });
    await expect(h.service.updateMemberRole('admin-1', 'space-1', 'member-1', 'moderator'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });

  it('does not permit a member to remove another member', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({ rows: [{ type: 'EVENT', status: 'active', role: 'member' }] });
    await expect(h.service.removeMember('member-1', 'space-1', 'member-2'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });

});
