import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AudioService } from './audio.service';
import { DatabaseService } from '../database/database.service';

describe('AudioService', () => {
  const query = jest.fn();
  const transaction = jest.fn();
  const db = { query, transaction } as unknown as DatabaseService;
  const service = new AudioService(db);

  beforeEach(() => { query.mockReset(); transaction.mockReset(); });

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
    transaction.mockImplementation(async (operation: (client: { query: jest.Mock }) => Promise<unknown>) =>
      operation({ query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 's', host_user_id: 'another-user', server_version: 1 }], rowCount: 1 }) }),
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
});
