import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DatabaseService } from '../database/database.service';

describe('NotificationsService', () => {
  const query = jest.fn();
  const service = new NotificationsService({ query } as unknown as DatabaseService);

  beforeEach(() => query.mockReset());

  it('accepts the maximum page size and returns an unread count', async () => {
    query.mockResolvedValueOnce({ rows: Array.from({ length: 100 }, (_, index) => ({ id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`, created_at: `2026-11-18T00:00:${String(59 - Math.floor(index / 2)).padStart(2, '0')}.000Z` })) });
    query.mockResolvedValueOnce({ rows: [{ count: 4 }] });

    const result = await service.list('user-1', undefined, 100);

    expect(query.mock.calls[0][1]).toEqual(['user-1', null, null, false, 100]);
    expect(query.mock.calls[0][0]).toContain('user_blocks');
    expect(query.mock.calls[1][0]).toContain('user_blocks');
    expect(result.unreadCount).toBe(4);
    expect(result.items).toHaveLength(100);
    expect(result.nextCursor).toBeTruthy();
  });

  it('rejects invalid cursors before querying', async () => {
    await expect(service.list('user-1', 'not-a-date')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed notification ids before querying', async () => {
    await expect(service.markRead('user-1', 'not-a-uuid')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not expose another user notification', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(service.markRead('user-1', '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][1]).toEqual(['11111111-1111-4111-8111-111111111111', 'user-1']);
  });

  it('marks all unread notifications for the authenticated user only', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 3 });
    await expect(service.markAllRead('user-1')).resolves.toEqual({ updated: 3 });
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });
  it('cancels a claimed push when the device was revoked before dispatch', async () => {
    const transaction=jest.fn();
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:'outbox-1',notification_id:'n1',user_id:'user-1',device_id:'device-1',attempts:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:'outbox-1',notification_id:'n1',user_id:'user-1',device_id:'device-1',attempts:1,platform:'ios',push_token_encrypted:'encrypted',category:'social.comment',payload:{}}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const dispatchService=new NotificationsService({query,transaction} as unknown as DatabaseService);
    query.mockResolvedValueOnce({rows:[{revoked_at:new Date(),push_token_encrypted:'encrypted',push_enabled:true}],rowCount:1});
    query.mockResolvedValueOnce({rows:[],rowCount:1});

    await expect(dispatchService.dispatchPushBatch(1)).resolves.toEqual({claimed:1,delivered:0,failed:0});
    expect(query.mock.calls[0][0]).toContain('d.revoked_at');
    expect(query.mock.calls[1][0]).toContain("status='cancelled'");
  });

  it('does not create notifications for suspended or deleted users',async()=>{
    const transaction=jest.fn();
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const createService=new NotificationsService({query,transaction} as unknown as DatabaseService);
    await expect(createService.createForUser('user-1','social.comment',{postId:'p1'}))
      .rejects.toThrow('Notification recipient is not active.');
    expect(clientQuery).toHaveBeenCalledTimes(2);
  });

  it('cancels pending push notifications from an actor the recipient has blocked',async()=>{
    const transaction=jest.fn();
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[{id:'outbox-2',notification_id:'n2',user_id:'user-1',device_id:'device-2',attempts:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{id:'outbox-2',notification_id:'n2',user_id:'user-1',device_id:'device-2',attempts:1,platform:'ios',push_token_encrypted:'encrypted',category:'social.comment',payload:{actorId:'blocked-user'}}],rowCount:1});
    transaction.mockImplementationOnce(async(work:any)=>work({query:clientQuery}));
    const dispatchService=new NotificationsService({query,transaction} as unknown as DatabaseService);
    query.mockResolvedValueOnce({rows:[{revoked_at:null,platform:'ios',push_token_encrypted:'encrypted',push_enabled:true,actor_blocked:true}],rowCount:1});
    query.mockResolvedValueOnce({rows:[],rowCount:1});
    await expect(dispatchService.dispatchPushBatch(1)).resolves.toEqual({claimed:1,delivered:0,failed:0});
    expect(query.mock.calls[1][1][1]).toBe('ACTOR_BLOCKED');
  });

});
