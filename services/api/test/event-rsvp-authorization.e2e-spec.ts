import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { EventRsvpsService } from '../src/events/event-rsvps.service';

describe('Event RSVP authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for event RSVP authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const rsvps = new EventRsvpsService(db);
  let ownerId: string;
  let memberId: string;
  let outsiderId: string;
  let spaceId: string;

  beforeEach(async () => {
    ownerId = randomUUID();
    memberId = randomUUID();
    outsiderId = randomUUID();
    spaceId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active'),($5,$6,'active')`,
      [
        ownerId, `rsvp-owner-${ownerId}@momentia.test`,
        memberId, `rsvp-member-${memberId}@momentia.test`,
        outsiderId, `rsvp-outsider-${outsiderId}@momentia.test`,
      ],
    );
    await pool.query(
      `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
       VALUES($1,'EVENT',$2,'RSVP authorization test','private','active')`,
      [spaceId, ownerId],
    );
    await pool.query('INSERT INTO event_details(space_id,starts_at,ends_at,timezone) VALUES($1,now()+interval \'1 day\',now()+interval \'2 days\',\'UTC\')', [spaceId]);
    await pool.query(
      `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
       VALUES($1,$2,'owner','active',now()),($1,$3,'member','active',now())`,
      [spaceId, ownerId, memberId],
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ownerId, memberId, outsiderId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not allow a non-member to create an RSVP or read event summary', async () => {
    await expect(rsvps.respond(outsiderId, spaceId, { response: 'going' }))
      .rejects.toThrow('Event not found.');
    await expect(rsvps.summary(outsiderId, spaceId))
      .rejects.toThrow('Event not found.');
    const rows = await pool.query('SELECT id FROM event_rsvps WHERE space_id=$1', [spaceId]);
    expect(rows.rows).toHaveLength(0);
  });

  it('returns aggregate RSVP counts to members but attendee details only to moderators', async () => {
    await rsvps.respond(memberId, spaceId, { response: 'going', guestCount: 1, note: 'Vegetarian' });

    const memberSummary = await rsvps.summary(memberId, spaceId);
    expect(memberSummary).toMatchObject({ going: 1, additional_guests: 1 });
    expect(memberSummary).not.toHaveProperty('attendees');

    const ownerSummary = await rsvps.summary(ownerId, spaceId);
    expect(ownerSummary).toMatchObject({ going: 1, additional_guests: 1 });
    expect(ownerSummary.attendees).toHaveLength(1);
    expect(ownerSummary.attendees[0]).toMatchObject({ user_id: memberId, note: 'Vegetarian' });
  });
});
