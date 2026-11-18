import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SpacesService } from './spaces.service';

describe('SpacesService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const database = { query, transaction } as unknown as DatabaseService;
  const service = new SpacesService(database);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

  it('validates event space input and normalizes the name', () => {
    expect(service.validateCreateInput({
      type: 'EVENT', name: '  Birthday  ', visibility: 'private',
      startsAt: '2026-12-01T10:00:00Z', endsAt: '2026-12-01T12:00:00Z',
    })).toMatchObject({ type: 'EVENT', name: 'Birthday', visibility: 'private' });
  });

  it('requires a second user for a couple space', () => {
    expect(() => service.validateCreateInput({ type: 'COUPLE', name: 'Us' }))
      .toThrow(BadRequestException);
  });

  it('does not add a partner to a couple space without an acceptance flow', async () => {
    await expect(service.create('user-1', {
      type: 'COUPLE', name: 'Us', visibility: 'private', partnerUserId: 'user-2',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid date ranges and unsupported properties', () => {
    expect(() => service.validateCreateInput({
      type: 'EVENT', name: 'Event', startsAt: '2026-12-02T10:00:00Z',
      endsAt: '2026-12-01T10:00:00Z',
    })).toThrow(BadRequestException);
    expect(() => service.validateCreateInput({
      type: 'CIRCLE', name: 'Friends', isAdmin: true,
    })).toThrow(BadRequestException);
  });

  it('lists only active memberships in active spaces', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 'space-1', type: 'CIRCLE' }] });
    await expect(service.listMine('user-1')).resolves.toEqual([{ id: 'space-1', type: 'CIRCLE' }]);
    expect(query.mock.calls[0][0]).toContain("sm.state = 'active'");
    expect(query.mock.calls[0][0]).toContain("s.status = 'active'");
  });

  it('does not reveal spaces the user cannot access', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.getMine('user-1', 'space-secret')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a circle and its owner membership atomically', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'space-1', type: 'CIRCLE', name: 'Friends' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const client = { query: clientQuery };
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) => work(client));
    await expect(service.create('user-1', {
      type: 'CIRCLE', name: 'Friends', visibility: 'private',
    })).resolves.toMatchObject({ id: 'space-1', memberCount: 1 });
    expect(clientQuery).toHaveBeenCalledTimes(3);
    expect(clientQuery.mock.calls[1][0]).toContain('space_memberships');
    expect(clientQuery.mock.calls[2][0]).toContain('circle_details');
  });

  it('creates an event with its details in one transaction', async () => {
    const clientQuery = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', type: 'EVENT', name: 'Launch' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    transaction.mockImplementationOnce(async (work: (client: unknown) => Promise<unknown>) => work({ query: clientQuery }));
    await service.create('user-1', { type: 'EVENT', name: 'Launch', visibility: 'private' });
    expect(clientQuery.mock.calls[2][0]).toContain('event_details');
  });
});
