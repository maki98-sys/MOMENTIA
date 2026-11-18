import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EventAlbumsService } from './event-albums.service';

function harness() {
  const clientQuery = jest.fn();
  const client = { query: clientQuery };
  const query = jest.fn();
  const transaction = jest.fn(async (operation: (clientArg: never) => Promise<unknown>) =>
    operation(client as never));
  const database = { query, transaction } as unknown as DatabaseService;
  return { service: new EventAlbumsService(database), clientQuery, query, transaction };
}

describe('EventAlbumsService', () => {
  it('does not expose album items to non-members', async () => {
    const h = harness();
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(h.service.listItems('user-1', 'album-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(h.query).toHaveBeenCalledTimes(1);
  });

  it('requires the uploaded media to be ready and owned by the member', async () => {
    const h = harness();
    h.clientQuery
      .mockResolvedValueOnce({ rows: [{ space_id: 'space-1', status: 'active', role: 'member' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(h.service.addMedia('user-1', 'album-1', 'media-1'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(h.clientQuery).toHaveBeenCalledTimes(2);
  });

  it('does not allow a member to remove another member photo', async () => {
    const h = harness();
    h.clientQuery.mockResolvedValueOnce({
      rows: [{ space_id: 'space-1', status: 'active', role: 'member',
        item_id: 'item-1', added_by: 'another-user' }],
    });
    await expect(h.service.removeMedia('user-1', 'album-1', 'media-1'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(h.clientQuery).toHaveBeenCalledTimes(1);
  });
});
