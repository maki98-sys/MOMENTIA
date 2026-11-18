import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  const query = jest.fn();
  const service = new MembershipsService({ query } as unknown as DatabaseService);

  beforeEach(() => query.mockReset());

  it('requires active membership before listing members', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.list('u1', 's1')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('lists members only after verifying caller access', async () => {
    query.mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 });
    query.mockResolvedValueOnce({ rows: [{ user_id: 'u1', role: 'owner' }] });
    await expect(service.list('u1', 's1')).resolves.toEqual([{ user_id: 'u1', role: 'owner' }]);
    expect(query.mock.calls[0][1]).toEqual(['s1', 'u1']);
    expect(query.mock.calls[1][1]).toEqual(['s1']);
  });

  it('rejects unsupported roles before querying', async () => {
    await expect(service.changeRole('u1', 's1', 'u2', 'owner')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('allows only the owner to grant admin role', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.changeRole('admin-1', 's1', 'u2', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][0]).toContain("owner.role = 'owner'");
  });

  it('prevents removing oneself through the moderation endpoint', async () => {
    await expect(service.remove('u1', 's1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('prevents owner self-removal through leave', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.leave('owner-1', 's1')).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls[0][0]).toContain("role <> 'owner'");
  });

  it('scopes member removal to an authorized active moderator', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 'u2', state: 'removed' }], rowCount: 1 });
    await expect(service.remove('mod-1', 's1', 'u2')).resolves.toMatchObject({ state: 'removed' });
    expect(query.mock.calls[0][0]).toContain("actor.role IN ('owner','admin','moderator')");
    expect(query.mock.calls[0][1]).toEqual(['mod-1', 's1', 'u2']);
  });
});
