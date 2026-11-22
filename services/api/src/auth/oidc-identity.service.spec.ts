import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { OidcIdentityService } from './oidc-identity.service';

function createHarness() {
  const query = jest.fn();
  const client = { query } as unknown as PoolClient;
  const database = {
    transaction: jest.fn(async (operation: (client: PoolClient) => Promise<unknown>) => operation(client)),
  } as unknown as DatabaseService;
  return { service: new OidcIdentityService(database), query, database };
}

const principal = {
  issuer: 'https://identity.example.test/',
  subject: 'subject-123',
  audience: ['momentia-api'],
  email: 'person@example.test',
  emailVerified: true,
};

describe('OidcIdentityService', () => {
  it('returns an existing active identity without creating a user', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // advisory transaction lock
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'active' }], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).resolves.toEqual({
      userId: 'user-1',
      created: false,
    });
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('rejects an existing identity whose account is not active', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // advisory transaction lock
      .mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'suspended' }], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a verified email before provisioning', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // advisory transaction lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // identity not found

    await expect(h.service.resolveOrProvision({ ...principal, emailVerified: false }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.query).toHaveBeenCalledTimes(2);
  });

  it('does not automatically link an identity to an existing email account', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // advisory transaction lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // identity not found
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // verified-email advisory lock
      .mockResolvedValueOnce({ rows: [{ id: 'existing-user' }], rowCount: 1 }); // email already owned

    await expect(h.service.resolveOrProvision(principal)).rejects.toBeInstanceOf(ConflictException);
    expect(h.query).toHaveBeenCalledTimes(4);
  });

  it('creates a user and external identity in the same transaction', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // advisory transaction lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // identity not found
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // verified-email advisory lock
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // email available
      .mockResolvedValueOnce({ rows: [{ id: 'new-user' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // user profile
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // external identity

    await expect(h.service.resolveOrProvision(principal)).resolves.toEqual({
      userId: 'new-user',
      created: true,
    });
    expect(h.query.mock.calls[4][0]).toContain('INSERT INTO users');
    expect(h.query.mock.calls[6][0]).toContain('INSERT INTO auth_identities');
  });
});
