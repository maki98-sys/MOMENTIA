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
    h.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'active' }], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).resolves.toEqual({
      userId: 'user-1',
      created: false,
    });
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
  });

  it('rejects an existing identity whose account is not active', async () => {
    const h = createHarness();
    h.query.mockResolvedValueOnce({ rows: [{ id: 'user-1', status: 'suspended' }], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a verified email before provisioning', async () => {
    const h = createHarness();
    h.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(h.service.resolveOrProvision({ ...principal, emailVerified: false }))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(h.query).toHaveBeenCalledTimes(2);
  });

  it('does not automatically link an identity to an existing email account', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-user' }], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).rejects.toBeInstanceOf(ConflictException);
    expect(h.query).toHaveBeenCalledTimes(3);
  });

  it('creates a user and external identity in the same transaction', async () => {
    const h = createHarness();
    h.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ id: 'new-user' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(h.service.resolveOrProvision(principal)).resolves.toEqual({
      userId: 'new-user',
      created: true,
    });
    expect(h.query.mock.calls[2][0]).toContain('INSERT INTO users');
    expect(h.query.mock.calls[3][0]).toContain('INSERT INTO auth_identities');
  });
});
