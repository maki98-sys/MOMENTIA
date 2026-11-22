import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { AudioService } from '../src/audio/audio.service';

describe('Social Audio authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for Social Audio authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const audio = new AudioService(db);

  let hostId: string;
  let outsiderId: string;
  let spaceId: string;

  beforeEach(async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    try {
      hostId = randomUUID();
      outsiderId = randomUUID();
      spaceId = randomUUID();

      await client.query(
        `INSERT INTO users(id,email_normalized,status)
         VALUES($1,$2,'active'),($3,$4,'active')`,
        [
          hostId,
          `audio-host-${hostId}@momentia.test`,
          outsiderId,
          `audio-outsider-${outsiderId}@momentia.test`,
        ],
      );

      await client.query(
        `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
         VALUES($1,'EVENT',$2,'Audio authorization fixture','private','active')`,
        [spaceId, hostId],
      );
      await client.query(
        `INSERT INTO event_details(space_id,timezone)
         VALUES($1,'UTC')`,
        [spaceId],
      );
      await client.query(
        `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
         VALUES($1,$2,'owner','active',now())`,
        [spaceId, hostId],
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
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[hostId, outsiderId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows an active space owner to create and read a Social Audio session', async () => {
    const created = await audio.createSession(hostId, spaceId, 'external');

    await expect(audio.getSession(hostId, created.id)).resolves.toMatchObject({
      id: created.id,
      space_id: spaceId,
      host_user_id: hostId,
      state: 'created',
    });
  });

  it('does not expose a session to a user who is not an active space member', async () => {
    const created = await audio.createSession(hostId, spaceId, 'external');

    await expect(audio.getSession(outsiderId, created.id)).rejects.toThrow('Audio session not found.');
    await expect(audio.join(outsiderId, created.id)).rejects.toThrow('Audio session not found.');

    const participants = await pool.query(
      'SELECT user_id FROM audio_participants WHERE session_id=$1 AND user_id=$2',
      [created.id, outsiderId],
    );
    expect(participants.rows).toHaveLength(0);
  });

  it('rejects joining a session after its space has been archived', async () => {
    const created = await audio.createSession(hostId, spaceId, 'external');
    await pool.query(`UPDATE spaces SET status='archived' WHERE id=$1`, [spaceId]);

    await expect(audio.join(hostId, created.id)).rejects.toThrow('Audio session not found.');

    const participant = await pool.query(
      'SELECT left_at FROM audio_participants WHERE session_id=$1 AND user_id=$2',
      [created.id, hostId],
    );
    expect(participant.rows[0].left_at).toBeNull();
  });
});
