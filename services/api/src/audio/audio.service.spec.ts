import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AudioService } from './audio.service';
import { DatabaseService } from '../database/database.service';

describe('AudioService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const db = { query, transaction } as unknown as DatabaseService;
  const service = new AudioService(db);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

  it('rejects heartbeat for a participant who is not active', async () => {
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{ok:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{enabled:true}],rowCount:1})
      .mockResolvedValueOnce({rows:[],rowCount:0});
    transaction.mockImplementationOnce(async(operation:any)=>operation({query:clientQuery}));
    await expect(service.heartbeat('user-1', '11111111-1111-4111-8111-111111111111'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(clientQuery).toHaveBeenCalledTimes(4);
  });

  it('refreshes heartbeat only for an active participant', async () => {
    const heartbeatAt = new Date('2026-11-18T04:00:00.000Z');
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{ok:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{enabled:true}],rowCount:1})
      .mockResolvedValueOnce({rows:[{session_id:'11111111-1111-4111-8111-111111111111',last_heartbeat_at:heartbeatAt}],rowCount:1});
    transaction.mockImplementationOnce(async(operation:any)=>operation({query:clientQuery}));
    await expect(service.heartbeat('user-1', '11111111-1111-4111-8111-111111111111'))
      .resolves.toEqual({ sessionId: '11111111-1111-4111-8111-111111111111', heartbeatAt });
    expect(clientQuery).toHaveBeenCalledTimes(4);
  });

  it('rejects malformed space identifiers before database access', async () => {
    await expect(service.createSession('user-1', 'bad-id', 'external')).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects providers outside the allowlist', async () => {
    await expect(service.createSession('user-1', '11111111-1111-4111-8111-111111111111', 'unknown')).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires a host-controlled playback action', async () => {
    const clientQuery=jest.fn()
      .mockResolvedValueOnce({rows:[],rowCount:0})
      .mockResolvedValueOnce({rows:[{ok:1}],rowCount:1})
      .mockResolvedValueOnce({rows:[{enabled:true}],rowCount:1})
      .mockResolvedValueOnce({ rows: [{ id: 's', host_user_id: 'another-user', server_version: 1 }], rowCount: 1 });
    transaction.mockImplementation(async (operation: (client: { query: jest.Mock }) => Promise<unknown>) =>
      operation({ query: clientQuery }),
    );
    await expect(service.updatePlayback('user-1', '11111111-1111-4111-8111-111111111111', { action: 'play' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects unsupported playback actions before database access', async () => {
    await expect(service.updatePlayback('user-1', '11111111-1111-4111-8111-111111111111', { action: 'skip' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects invalid votes before database access', async () => {
    await expect(service.vote('user-1', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 0))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('requires an active account, membership and fresh heartbeat for socket participation', async () => {
    query.mockResolvedValueOnce({rows:[{ok:1}],rowCount:1});
    await expect(service.isActiveParticipant(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    )).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain("u.status='active'");
    expect(query.mock.calls[0][0]).toContain("sm.state='active'");
    expect(query.mock.calls[0][0]).toContain('last_heartbeat_at');
  });

});
