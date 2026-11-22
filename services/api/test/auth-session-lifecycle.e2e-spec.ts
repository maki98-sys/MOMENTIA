jest.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setSubject() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'mock.signed.access.token'; }
  },
  jwtVerify: jest.fn(),
}));

import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { DeviceSessionService } from '../src/auth/device-session.service';
import { SessionTokenService } from '../src/auth/session-token.service';

describe('SessionTokenService PostgreSQL lifecycle', () => {
  let pool: Pool;
  let database: DatabaseService;
  let sessions: SessionTokenService;
  let devices: DeviceSessionService;
  let userId: string;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for auth E2E tests.');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    database = new DatabaseService(pool);
    const config = new ConfigService({ MOMENTIA_SESSION_SECRET: 'momentia-e2e-session-secret-'.padEnd(64, 'x') });
    sessions = new SessionTokenService(database, config);
    devices = new DeviceSessionService(database);
  });

  beforeEach(async () => {
    userId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active')`,
      [userId, `auth-e2e-${userId}@momentia.test`],
    );
  });

  afterEach(async () => {
    if (!userId) return;
    await pool.query('DELETE FROM user_audit_events WHERE actor_id=$1 OR subject_user_id=$1', [userId]);
    await pool.query('DELETE FROM auth_sessions WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM devices WHERE user_id=$1', [userId]);
    await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('rotates refresh tokens and revokes the complete family after token reuse', async () => {
    const created = await sessions.create(userId);
    const rotated = await sessions.refresh(created.refreshToken);
    expect(rotated.refreshToken).not.toBe(created.refreshToken);

    await expect(sessions.refresh(created.refreshToken))
      .rejects.toThrow('Refresh token reuse detected. The session family was revoked.');

    const stored = await pool.query('SELECT revoked_at FROM auth_sessions WHERE id=$1', [created.sessionId]);
    expect(stored.rows[0].revoked_at).not.toBeNull();
  });

  it('does not issue a refresh token for a session that was already revoked', async () => {
    const created = await sessions.create(userId);
    await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE id=$1', [created.sessionId]);

    await expect(sessions.refresh(created.refreshToken))
      .rejects.toThrow('Session is no longer active.');
    const tokens = await pool.query(
      'SELECT count(*)::int AS count FROM auth_session_refresh_tokens WHERE session_id=$1',
      [created.sessionId],
    );
    expect(tokens.rows[0].count).toBe(1);
  });

  it('does not refresh a session after its device has been revoked', async () => {
    const device = await devices.registerDevice(userId, {
      deviceKey: randomUUID(),
      platform: 'android',
    });
    const created = await sessions.create(userId, device.id);
    await pool.query('UPDATE devices SET revoked_at=now() WHERE id=$1', [device.id]);

    await expect(sessions.refresh(created.refreshToken))
      .rejects.toThrow('Session is no longer active.');
    const tokens = await pool.query(
      'SELECT count(*)::int AS count FROM auth_session_refresh_tokens WHERE session_id=$1',
      [created.sessionId],
    );
    expect(tokens.rows[0].count).toBe(1);
  });

  it('allows only one concurrent refresh and revokes the family when the old token is reused', async () => {
    const created = await sessions.create(userId);
    const results = await Promise.allSettled([
      sessions.refresh(created.refreshToken),
      sessions.refresh(created.refreshToken),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(Error);
    expect(rejected.reason.message).toMatch(/Refresh token reuse detected|Session is no longer active|Refresh token was already used/);

    const stored = await pool.query('SELECT revoked_at FROM auth_sessions WHERE id=$1', [created.sessionId]);
    expect(stored.rows[0].revoked_at).not.toBeNull();
  });
});
