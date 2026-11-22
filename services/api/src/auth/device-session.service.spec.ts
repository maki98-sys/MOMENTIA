import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DeviceSessionService } from './device-session.service';

describe('DeviceSessionService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  let service: DeviceSessionService;
  beforeEach(() => {
    jest.clearAllMocks();
    transaction.mockImplementation(async (fn: any) => fn({ query }));
    service = new DeviceSessionService({ query, transaction } as unknown as DatabaseService);
  });

  it('registers a supported device without returning push credentials', async () => {
    query.mockResolvedValueOnce({rowCount:1,rows:[{id:'user-1'}]})
      .mockResolvedValueOnce({rowCount:0,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:'device-1',platform:'android'}]})
      .mockResolvedValueOnce({rowCount:1,rows:[]});
    await expect(service.registerDevice('11111111-1111-4111-8111-111111111111', { deviceKey:'22222222-2222-4222-8222-222222222222', platform: 'android' }))
      .resolves.toMatchObject({ id: 'device-1', platform: 'android' });
    expect(query.mock.calls[0][0]).toContain("status='active'");
    expect(query.mock.calls[2][0]).toContain('INSERT INTO devices');
    expect(query.mock.calls[2][1]).toEqual(['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','android',null]);
  });

  it('rejects unsupported device platforms and fields', async () => {
    await expect(service.registerDevice('11111111-1111-4111-8111-111111111111', { deviceKey:'22222222-2222-4222-8222-222222222222', platform: 'desktop' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.registerDevice('11111111-1111-4111-8111-111111111111', { platform: 'ios', userId: 'other-user' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects push tokens for web devices until a web push provider exists', async () => {
    await expect(service.registerDevice('11111111-1111-4111-8111-111111111111', {
      deviceKey:'22222222-2222-4222-8222-222222222222',platform:'web',pushToken:'web-push-token',
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not register a device for an inactive account', async () => {
    query.mockResolvedValueOnce({rowCount:0,rows:[]});
    await expect(service.registerDevice('11111111-1111-4111-8111-111111111111',{deviceKey:'22222222-2222-4222-8222-222222222222',platform:'ios'}))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('transfers a stable device key and revokes the previous account sessions', async () => {
    query.mockResolvedValueOnce({rowCount:1,rows:[{id:'user-2'}]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:'device-1',user_id:'user-1'}]})
      .mockResolvedValueOnce({rowCount:2,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[]})
      .mockResolvedValueOnce({rowCount:1,rows:[{id:'device-1',platform:'ios'}]})
      .mockResolvedValueOnce({rowCount:1,rows:[]});
    await expect(service.registerDevice('user-2',{
      deviceKey:'22222222-2222-4222-8222-222222222222',platform:'ios',
    })).resolves.toMatchObject({id:'device-1',platform:'ios'});
    expect(query.mock.calls[2][0]).toContain('UPDATE auth_sessions');
    expect(query.mock.calls[3][0]).toContain('UPDATE notification_outbox');
    expect(query.mock.calls[4][0]).toContain('UPDATE devices SET user_id');
  });

  it('lists only active devices owned by the authenticated user', async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ id: 'device-1' }] });
    await service.listDevices('user-1');
    expect(query.mock.calls[0][0]).toContain('user_id=$1 AND revoked_at IS NULL');
    expect(query.mock.calls[0][1]).toEqual(['user-1']);
  });

  it('revokes a device and its sessions in one transaction', async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'device-1' }] })
      .mockResolvedValueOnce({ rowCount: 2, rows: [] })
      .mockResolvedValueOnce({ rowCount: 3, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(service.revokeDevice('user-1', '11111111-1111-4111-8111-111111111111')).resolves.toEqual({ revoked: true, revokedSessions: 2, cancelledPushDeliveries: 3 });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(4);
    expect(query.mock.calls[1][0]).toContain('UPDATE auth_sessions');
    expect(query.mock.calls[2][0]).toContain('UPDATE notification_outbox');
  });

  it('does not revoke a device owned by another user', async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(service.revokeDevice('user-1', '11111111-1111-4111-8111-111111111111')).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('revokes only a session belonging to the authenticated user', async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(service.revokeSession('user-1', '22222222-2222-4222-8222-222222222222')).rejects.toBeInstanceOf(NotFoundException);
    expect(query.mock.calls[0][0]).toContain('WHERE id=$1 AND user_id=$2');
  });

  it('revokes all active sessions for one user only', async () => {
    query.mockResolvedValue({ rowCount: 3, rows: [{ id: '1' }, { id: '2' }, { id: '3' }] });
    await expect(service.revokeAllSessions('user-1')).resolves.toEqual({ revokedCount: 3 });
    expect(query.mock.calls[0][0]).toContain('WHERE user_id=$1 AND revoked_at IS NULL');
    expect(query).toHaveBeenCalledTimes(4);
  });
});
