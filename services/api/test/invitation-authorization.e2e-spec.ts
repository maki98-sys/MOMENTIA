import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { InvitationsService } from '../src/invitations/invitations.service';

describe('Space invitation authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for invitation authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const invitations = new InvitationsService(db);
  let ownerId: string;
  let inviteeId: string;
  let spaceId: string;

  beforeEach(async () => {
    ownerId = randomUUID();
    inviteeId = randomUUID();
    spaceId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active')`,
      [ownerId, `invite-owner-${ownerId}@momentia.test`, inviteeId, `invite-user-${inviteeId}@momentia.test`],
    );
    await pool.query(
      `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
       VALUES($1,'EVENT',$2,'Invitation authorization test','private','active')`,
      [spaceId, ownerId],
    );
    await pool.query('INSERT INTO event_details(space_id,timezone) VALUES($1,\'UTC\')', [spaceId]);
    await pool.query(
      `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
       VALUES($1,$2,'owner','active',now())`,
      [spaceId, ownerId],
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
    await pool.query(
      'DELETE FROM user_blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[])',
      [[ownerId, inviteeId]],
    );
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ownerId, inviteeId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createInvitation() {
    return invitations.create(ownerId, spaceId, {
      role: 'member',
      expiresInDays: 7,
      maxUses: 1,
    });
  }

  it('does not let an account join after the space owner blocks it', async () => {
    const invite = await createInvitation();
    await pool.query(
      'INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)',
      [ownerId, inviteeId],
    );

    await expect(invitations.accept(inviteeId, invite.token))
      .rejects.toThrow('Invitation is invalid or unavailable.');

    const membership = await pool.query(
      'SELECT state FROM space_memberships WHERE space_id=$1 AND user_id=$2',
      [spaceId, inviteeId],
    );
    expect(membership.rows).toHaveLength(0);

    const uses = await pool.query('SELECT uses FROM space_invitations WHERE id=$1', [invite.id]);
    expect(uses.rows[0].uses).toBe(0);
  });

  it('does not let a suspended account accept an otherwise valid invitation', async () => {
    const invite = await createInvitation();
    await pool.query("UPDATE users SET status='suspended' WHERE id=$1", [inviteeId]);

    await expect(invitations.accept(inviteeId, invite.token))
      .rejects.toThrow('Invitation is invalid or unavailable.');

    const membership = await pool.query(
      'SELECT state FROM space_memberships WHERE space_id=$1 AND user_id=$2',
      [spaceId, inviteeId],
    );
    expect(membership.rows).toHaveLength(0);
  });
});
