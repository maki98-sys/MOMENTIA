import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const service = new MembershipsService({ query, transaction } as unknown as DatabaseService);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

  it('requires active membership before listing members', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.list('u1', 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('lists members only after verifying caller access', async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [{ user_id: 'u1', role: 'owner', display_name: 'Member', avatar_media_id: null }] });
    await expect(service.list('u1', 's1')).resolves.toEqual([{ user_id: 'u1', role: 'owner', display_name: 'Member', avatar_media_id: null }]);
    expect(query.mock.calls[0][1]).toEqual(['s1', 'u1']);
    expect(query.mock.calls[1][1]).toEqual(['s1']);
    expect(query.mock.calls[1][0]).toContain('LEFT JOIN user_profiles');
    expect(query.mock.calls[1][0]).not.toContain('u.display_name');
  });

  it('rejects unsupported roles before querying', async () => {
    await expect(service.changeRole('u1', 's1', 'u2', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows only the owner to grant admin role', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.changeRole('admin-1', 's1', 'u2', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery.mock.calls[0][0]).toContain("owner.role='owner'");
  });

  it('prevents admins from changing another admin role', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.changeRole('admin-1', 's1', 'admin-2', 'member')).rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery.mock.calls[0][0]).toContain("target.role<>'admin'");
    expect(clientQuery.mock.calls[0][0]).toContain("owner.role='owner'");
  });

  it('prevents moderators from removing another moderator', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.remove('mod-1', 's1', 'mod-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery.mock.calls[0][0]).toContain("target.role <> 'moderator' OR EXISTS");
    expect(clientQuery.mock.calls[0][0]).toContain("admin_or_owner.role IN ('owner','admin')");
  });

  it('prevents removing oneself through the moderation endpoint', async () => {
    await expect(service.remove('u1', 's1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('transfers ownership atomically to another active member and records an audit event', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 's1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ user_id: 'u2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) =>
      work({ query: clientQuery }));
    await expect(service.transferOwnership('u1', 's1', 'u2')).resolves.toEqual({
      spaceId: 's1', previousOwnerId: 'u1', ownerId: 'u2',
    });
    expect(clientQuery).toHaveBeenCalledTimes(6);
    expect(clientQuery.mock.calls[2][0]).toContain("role = 'admin'");
    expect(clientQuery.mock.calls[3][0]).toContain("role = 'owner'");
    expect(clientQuery.mock.calls[4][0]).toContain('UPDATE spaces SET owner_id');
    expect(clientQuery.mock.calls[5][0]).toContain('space_audit_events');
  });

  it('rejects ownership transfer to a non-member without changing ownership', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 's1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) =>
      work({ query: clientQuery }));
    await expect(service.transferOwnership('u1', 's1', 'u3')).rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('prevents owner self-removal through leave', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.leave('owner-1', 's1')).rejects.toBeInstanceOf(BadRequestException);
    expect(clientQuery.mock.calls[0][0]).toContain("role <> 'owner'");
  });

  it('scopes member removal to an authorized active moderator', async () => {
    const clientQuery=jest.fn().mockResolvedValueOnce({rows:[{user_id:'u2',state:'removed'}],rowCount:1}).mockResolvedValueOnce({rows:[],rowCount:0}).mockResolvedValueOnce({rows:[],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    await expect(service.remove('mod-1', 's1', 'u2')).resolves.toMatchObject({ state: 'removed' });
    expect(clientQuery.mock.calls[0][0]).toContain("actor.role IN ('owner','admin','moderator')");
    expect(clientQuery.mock.calls[0][1]).toEqual(['mod-1', 's1', 'u2']);
  });
});
