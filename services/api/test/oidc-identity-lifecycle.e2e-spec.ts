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
    await pool.query(
      'DELETE FROM user_audit_events WHERE actor_id=ANY($1::uuid[]) OR subject_user_id=ANY($1::uuid[])',
      [[userId,otherUserId]],
    );
    await pool.query('DELETE FROM auth_identities WHERE user_id=ANY($1::uuid[])',[[userId,otherUserId]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userId,otherUserId]]);
  });

  afterAll(async () => { await pool.end(); });

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
});
