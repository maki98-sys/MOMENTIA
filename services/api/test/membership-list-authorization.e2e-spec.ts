import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { MembershipsService } from '../src/memberships/memberships.service';

describe('Space membership list authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for membership authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const memberships = new MembershipsService(db);
  let ownerId: string;
  let viewerId: string;
  let blockedId: string;
  let spaceId: string;

  beforeEach(async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
    ownerId = randomUUID();
    viewerId = randomUUID();
    blockedId = randomUUID();
    spaceId = randomUUID();
    await client.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active'),($5,$6,'active')`,
      [
        ownerId, `member-owner-${ownerId}@momentia.test`,
        viewerId, `member-viewer-${viewerId}@momentia.test`,
        blockedId, `member-blocked-${blockedId}@momentia.test`,
      ],
    );
    await client.query(
      `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
       VALUES($1,'CIRCLE',$2,'Membership authorization test','private','active')`,
      [spaceId, ownerId],
    );
    await client.query('INSERT INTO circle_details(space_id) VALUES($1)', [spaceId]);
    await client.query(
      `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
       VALUES($1,$2,'owner','active',now()),($1,$3,'member','active',now()),($1,$4,'member','active',now())`,
      [spaceId, ownerId, viewerId, blockedId],
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
      [[ownerId, viewerId, blockedId]],
    );
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ownerId, viewerId, blockedId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not expose a blocked member in the membership list', async () => {
    await pool.query('INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [viewerId, blockedId]);

    const rows = await memberships.list(viewerId, spaceId);
    expect(rows.map(row => row.user_id)).toContain(ownerId);
    expect(rows.map(row => row.user_id)).toContain(viewerId);
    expect(rows.map(row => row.user_id)).not.toContain(blockedId);
  });

  it('does not expose the membership list after the space is closed', async () => {
    await pool.query("UPDATE spaces SET status='closed',closed_at=now() WHERE id=$1", [spaceId]);

    await expect(memberships.list(viewerId, spaceId)).rejects.toThrow('Space not found.');
  });
});
