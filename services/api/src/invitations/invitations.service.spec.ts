import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { DatabaseService } from '../database/database.service';

describe('InvitationsService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const database = { query, transaction } as unknown as DatabaseService;
  const service = new InvitationsService(database);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

  it('defaults to a seven-day member invitation', () => {
    expect(service.validateCreateInput({})).toEqual({ role: 'member', expiresInDays: 7, maxUses: 1 });
  });

  it('rejects privilege escalation and invalid expiry', () => {
    expect(() => service.validateCreateInput({ role: 'owner' })).toThrow(BadRequestException);
    expect(() => service.validateCreateInput({ expiresInDays: 31 })).toThrow(BadRequestException);
    expect(() => service.validateCreateInput({ role: 'guest', isAdmin: true })).toThrow(BadRequestException);
  });

  it('creates a hashed, single-use invitation only for active space admins or owners', async () => {
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rowCount:1,rows:[{id:'invite-1',role:'member',space_id:'space-1',expires_at:'2026-12-01'}]})
      .mockResolvedValueOnce({rowCount:1,rows:[]});
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) => work({query:clientQuery}));
    const result = await service.create('user-1', 'space-1', { role: 'member', expiresInDays: 7, maxUses: 1 });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(clientQuery.mock.calls[0][0]).toContain("sm.role IN ('owner','admin')");
    expect(clientQuery.mock.calls[0][0]).toContain('token_hash');
    expect(clientQuery.mock.calls[0][1][2]).not.toBe(result.token);
    expect(clientQuery.mock.calls[1][0]).toContain('space_audit_events');
  });

  it('does not reveal inaccessible spaces when creating invitations', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rowCount:0,rows:[]});
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) => work({query:clientQuery}));
    await expect(service.create('user-1', 'secret', { role: 'member', expiresInDays: 7, maxUses: 1 }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects malformed invitation tokens before database access', async () => {
    await expect(service.accept('user-2', 'bad-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('activates a membership and consumes a valid invitation atomically', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        id: 'invite-1', space_id: 'space-1', role: 'guest',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        max_uses: 1, uses: 0, approval_required: false,
        revoked_at: null, type: 'EVENT', status: 'active',
      }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) =>
      work({ query: clientQuery }));
    await expect(service.accept('user-2', 'a'.repeat(43))).resolves.toEqual({
      spaceId: 'space-1', role: 'guest', membership: 'active',
    });
    expect(clientQuery).toHaveBeenCalledTimes(6);
    expect(clientQuery.mock.calls[3][0]).toContain('INSERT INTO space_memberships');
    expect(clientQuery.mock.calls[4][0]).toContain('uses = uses + 1');
    expect(clientQuery.mock.calls[5][0]).toContain('space_audit_events');
  });

  it('does not accept an invitation for a couple space through the generic flow', async () => {
    const clientQuery = jest.fn().mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({ rowCount: 1, rows: [{
      id: 'invite-1', space_id: 'space-1', role: 'member',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      max_uses: 1, uses: 0, approval_required: false,
      revoked_at: null, type: 'COUPLE', status: 'active',
    }] });
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) =>
      work({ query: clientQuery }));
    await expect(service.accept('user-2', 'b'.repeat(43))).rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });
});
