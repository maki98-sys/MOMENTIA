import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { OidcIdentityService } from '../src/auth/oidc-identity.service';

describe('OIDC identity lifecycle (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for OIDC identity E2E tests.');
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const database = new DatabaseService(pool);
  const identities = new OidcIdentityService(database);
  let userId: string;
  let otherUserId: string;
  const provisionedUserIds: string[] = [];
  const provider = 'https://oidc-e2e.momentia.test/';
  const subject = () => randomUUID();

  beforeEach(async () => {
    userId = randomUUID();
    otherUserId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active')`,
      [userId,`${userId}@oidc-e2e.test`,otherUserId,`${otherUserId}@oidc-e2e.test`],
    );
  });

  afterEach(async () => {
    if (provisionedUserIds.length) {
      await pool.query('DELETE FROM user_audit_events WHERE actor_id=ANY($1::uuid[]) OR subject_user_id=ANY($1::uuid[])', [provisionedUserIds]);
      await pool.query('DELETE FROM auth_identities WHERE user_id=ANY($1::uuid[])', [provisionedUserIds]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [provisionedUserIds]);
      provisionedUserIds.length = 0;
    }
    await pool.query(
      'DELETE FROM user_audit_events WHERE actor_id=ANY($1::uuid[]) OR subject_user_id=ANY($1::uuid[])',
      [[userId,otherUserId]],
    );
    await pool.query('DELETE FROM auth_identities WHERE user_id=ANY($1::uuid[])',[[userId,otherUserId]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userId,otherUserId]]);
  });

  afterAll(async () => { await pool.end(); });


  it('provisions a new account only from a verified external email', async () => {
    const externalSubject = subject();
    const result = await identities.resolveOrProvision({
      issuer: provider, subject: externalSubject, audience: ['momentia-api'],
      email: `new-${randomUUID()}@oidc-e2e.test`, emailVerified: true,
    });
    expect(result.created).toBe(true);
    provisionedUserIds.push(result.userId);
    const stored = await pool.query(
      `SELECT u.status,u.email_verified_at,p.visibility,ai.provider_subject
       FROM users u
       JOIN user_profiles p ON p.user_id=u.id
       JOIN auth_identities ai ON ai.user_id=u.id
       WHERE u.id=$1`,
      [result.userId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      status: 'active', visibility: 'private', provider_subject: externalSubject,
    });
    expect(stored.rows[0].email_verified_at).not.toBeNull();
  });

  it('does not auto-link a new external identity to an existing account by matching email', async () => {
    const externalSubject = subject();
    const email = `${userId}@oidc-e2e.test`;
    await pool.query('UPDATE users SET email_normalized=$2 WHERE id=$1', [userId,email]);
    await expect(identities.resolveOrProvision({
      issuer: provider, subject: externalSubject, audience: ['momentia-api'],
      email, emailVerified: true,
    })).rejects.toThrow('Sign in to that account before linking');
    const stored = await pool.query(
      'SELECT id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider,externalSubject],
    );
    expect(stored.rows).toHaveLength(0);
  });

  it('serializes concurrent first-login provisioning for the same external identity', async () => {
    const externalSubject = subject();
    const email = `concurrent-${randomUUID()}@oidc-e2e.test`;
    const principal = {
      issuer: provider, subject: externalSubject, audience: ['momentia-api'],
      email, emailVerified: true,
    };
    const results = await Promise.all([
      identities.resolveOrProvision(principal),
      identities.resolveOrProvision(principal),
    ]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(results[0].userId).toBe(results[1].userId);
    provisionedUserIds.push(results[0].userId);
    const stored = await pool.query(
      'SELECT id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider, externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
  });

  it('rejects sign-in through an identity attached to a suspended account', async () => {
    const externalSubject = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)',
      [userId, provider, externalSubject],
    );
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [userId]);
    await expect(identities.resolveOrProvision({
      issuer: provider, subject: externalSubject, audience: ['momentia-api'],
    })).rejects.toThrow('not active');
    const stored = await pool.query(
      'SELECT user_id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider, externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].user_id).toBe(userId);
  });

  it('does not provision an account when the provider email is unverified', async () => {
    const email = `unverified-${randomUUID()}@oidc-e2e.test`;
    await expect(identities.resolveOrProvision({
      issuer: provider, subject: subject(), audience: ['momentia-api'],
      email, emailVerified: false,
    })).rejects.toThrow('verified email address is required');
    const stored = await pool.query('SELECT id FROM users WHERE email_normalized=$1',[email]);
    expect(stored.rows).toHaveLength(0);
  });

  it('links a separately proven identity to the authenticated account', async () => {
    const externalSubject = subject();
    await expect(identities.linkAuthenticatedIdentity(userId,{
      issuer:provider,subject:externalSubject,audience:['momentia-api'],
    })).resolves.toEqual({linked:true});
    const stored = await pool.query(
      'SELECT user_id,provider,provider_subject FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider,externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({user_id:userId,provider,provider_subject:externalSubject});
  });

  it('does not allow an external identity already owned by another account to be linked', async () => {
    const externalSubject = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)',
      [otherUserId,provider,externalSubject],
    );
    await expect(identities.linkAuthenticatedIdentity(userId,{
      issuer:provider,subject:externalSubject,audience:['momentia-api'],
    })).rejects.toThrow('already linked to another MOMENTIA account');
    const stored = await pool.query(
      'SELECT user_id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider,externalSubject],
    );
    expect(stored.rows[0].user_id).toBe(otherUserId);
  });

  it('does not allow unlinking the last sign-in identity', async () => {
    const externalSubject = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)',
      [userId,provider,externalSubject],
    );
    await expect(identities.unlinkAuthenticatedIdentity(userId,{
      issuer:provider,subject:externalSubject,audience:['momentia-api'],
    })).rejects.toThrow('The last sign-in identity cannot be removed');
    const stored = await pool.query(
      'SELECT id FROM auth_identities WHERE user_id=$1 AND provider=$2 AND provider_subject=$3',
      [userId,provider,externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
  });

  it('unlinks an identity only when another sign-in identity remains', async () => {
    const first = subject();
    const second = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3),($1,$4,$5)',
      [userId,provider,first,'https://second-oidc-e2e.momentia.test/',second],
    );
    await expect(identities.unlinkAuthenticatedIdentity(userId,{
      issuer:provider,subject:first,audience:['momentia-api'],
    })).resolves.toEqual({unlinked:true});
    const remaining = await pool.query('SELECT provider_subject FROM auth_identities WHERE user_id=$1',[userId]);
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0].provider_subject).toBe(second);
  });


  it('lists only identities belonging to the authenticated account', async () => {
    const ownSubject = subject();
    const foreignSubject = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3),($4,$2,$5)',
      [userId,provider,ownSubject,otherUserId,foreignSubject],
    );
    const result = await identities.listAuthenticatedIdentities(userId);
    expect(result.identities).toHaveLength(1);
    expect(result.identities[0].provider).toBe(provider);
    expect(result.canUnlink).toBe(false);
  });

  it('does not allow another account to unlink an identity it does not own', async () => {
    const externalSubject = subject();
    await pool.query(
      'INSERT INTO auth_identities(user_id,provider,provider_subject) VALUES($1,$2,$3)',
      [userId,provider,externalSubject],
    );
    await expect(identities.unlinkAuthenticatedIdentity(otherUserId,{
      issuer:provider,subject:externalSubject,audience:['momentia-api'],
    })).rejects.toThrow('not linked to the current account');
    const stored = await pool.query(
      'SELECT user_id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider,externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].user_id).toBe(userId);
  });


  it('serializes concurrent attempts to claim the same external identity', async () => {
    const externalSubject = subject();
    const attempts = await Promise.allSettled([
      identities.linkAuthenticatedIdentity(userId,{
        issuer:provider,subject:externalSubject,audience:['momentia-api'],
      }),
      identities.linkAuthenticatedIdentity(otherUserId,{
        issuer:provider,subject:externalSubject,audience:['momentia-api'],
      }),
    ]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const stored = await pool.query(
      'SELECT user_id FROM auth_identities WHERE provider=$1 AND provider_subject=$2',
      [provider,externalSubject],
    );
    expect(stored.rows).toHaveLength(1);
    expect([userId,otherUserId]).toContain(stored.rows[0].user_id);
  });
});
