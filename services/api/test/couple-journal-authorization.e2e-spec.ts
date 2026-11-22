import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { CoupleJournalService } from '../src/couple-journal/couple-journal.service';

describe('Couple journal authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for couple journal authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const journal = new CoupleJournalService(db);
  let ownerId: string;
  let partnerId: string;
  let spaceId: string;

  beforeEach(async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      ownerId = randomUUID();
      partnerId = randomUUID();
      spaceId = randomUUID();
      await client.query(
        `INSERT INTO users(id,email_normalized,status)
         VALUES($1,$2,'active'),($3,$4,'active')`,
        [ownerId, `couple-owner-${ownerId}@momentia.test`, partnerId, `couple-partner-${partnerId}@momentia.test`],
      );
      await client.query(
        `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
         VALUES($1,'COUPLE',$2,'Couple journal authorization test','private','active')`,
        [spaceId, ownerId],
      );
      await client.query('INSERT INTO couple_details(space_id) VALUES($1)', [spaceId]);
      await client.query(
        `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
         VALUES($1,$2,'owner','active',now()),($1,$3,'member','active',now())`,
        [spaceId, ownerId, partnerId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  afterEach(async () => {
    await pool.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
    await pool.query(
      'DELETE FROM user_blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[])',
      [[ownerId, partnerId]],
    );
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ownerId, partnerId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('denies journal access after either partner blocks the other', async () => {
    await pool.query(
      'INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)',
      [partnerId, ownerId],
    );

    await expect(journal.list(spaceId, ownerId)).rejects.toThrow('Couple space not found.');
  });

  it('denies journal access when the other partner account is suspended', async () => {
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [partnerId]);

    await expect(journal.list(spaceId, ownerId)).rejects.toThrow('Couple space not found.');
  });
});
