import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { SyncService } from '../src/sync/sync.service';

describe('Sync snapshot authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for sync snapshot e2e tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const sync = new SyncService(db);

  let viewerId: string;
  let ownerId: string;
  let authorId: string;
  let spaceId: string;

  beforeEach(async () => {
    viewerId = randomUUID();
    ownerId = randomUUID();
    authorId = randomUUID();
    spaceId = randomUUID();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO users(id,email_normalized,status)
         VALUES ($1,$2,'active'),($3,$4,'active'),($5,$6,'active')`,
        [viewerId, `${viewerId}@snapshot.test`, ownerId, `${ownerId}@snapshot.test`, authorId, `${authorId}@snapshot.test`],
      );
      await client.query(
        `INSERT INTO spaces(id,type,owner_id,name,visibility,status)
         VALUES ($1,'EVENT',$2,'Snapshot authorization test','private','active')`,
        [spaceId, ownerId],
      );
      await client.query(
        `INSERT INTO event_details(space_id,timezone) VALUES ($1,'UTC')`,
        [spaceId],
      );
      // The database invariant requires the space owner to have an active owner membership.
      await client.query(
        `INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
         VALUES ($1,$2,'owner','active',now()),($1,$3,'member','active',now())`,
        [spaceId, ownerId, viewerId],
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
    if (spaceId) await pool.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
    await pool.query('DELETE FROM user_blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[])', [[viewerId, ownerId, authorId]]);
    await pool.query('DELETE FROM user_relationships WHERE requester_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])', [[viewerId, ownerId, authorId]]);
    await pool.query('DELETE FROM sync_change_log WHERE user_id=ANY($1::uuid[])', [[viewerId, ownerId, authorId]]);
    for (const id of [viewerId, ownerId, authorId]) {
      if (id) await pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  async function createTimelinePost(audience: 'public' | 'followers', occurredAt: string, postAuthorId = authorId) {
    const postId = randomUUID();
    await pool.query(
      `INSERT INTO posts(id,author_id,space_id,body,audience,status,published_at)
       VALUES ($1,$2,$3,'snapshot fixture',$4,'published',now())`,
      [postId, postAuthorId, spaceId, audience],
    );
    await pool.query(
      `INSERT INTO timeline_entries(space_id,post_id,occurred_at,source)
       VALUES ($1,$2,$3::timestamptz,'post')`,
      [spaceId, postId, occurredAt],
    );
    return postId;
  }

  it('filters follower-only posts and stops pagination after membership revocation', async () => {
    const newestPublic = await createTimelinePost('public', '2026-11-21T12:00:00Z');
    await createTimelinePost('public', '2026-11-21T11:00:00Z');
    const followerOnly = await createTimelinePost('followers', '2026-11-21T10:00:00Z');

    const full = await sync.snapshot(viewerId, {
      sections: ['posts', 'timeline'],
      limit: 100,
    });
    expect(full.data.posts.map((row: any) => row.id)).not.toContain(followerOnly);
    expect(full.data.timeline.map((row: any) => row.post_id)).not.toContain(followerOnly);
    expect(full.data.timeline.map((row: any) => row.post_id)).toEqual([newestPublic, expect.any(String)]);

    const firstPage = await sync.snapshot(viewerId, {
      sections: ['timeline'],
      limit: 1,
    });
    expect(firstPage.data.timeline).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextOffsets.timeline).toBe(1);

    await pool.query(
      `UPDATE space_memberships
       SET state='left',left_at=now()
       WHERE space_id=$1 AND user_id=$2 AND state='active'`,
      [spaceId, viewerId],
    );

    const nextPage = await sync.snapshot(viewerId, {
      snapshotId: firstPage.snapshotId,
      offsets: firstPage.nextOffsets,
      limit: 1,
    });
    expect(nextPage.data.timeline).toEqual([]);
    expect(nextPage.hasMore).toBe(false);
  });
  it('revalidates follower-only timeline content after unfollow', async () => {
    await pool.query(
      `INSERT INTO user_relationships(requester_id,target_id,state)
       VALUES($1,$2,'accepted')`,
      [viewerId, authorId],
    );
    await createTimelinePost('public', '2026-11-21T12:00:00Z', ownerId);
    const followerPost = await createTimelinePost('followers', '2026-11-21T11:00:00Z');

    const firstPage = await sync.snapshot(viewerId, { sections: ['timeline'], limit: 1 });
    expect(firstPage.data.timeline).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);

    await pool.query(
      `DELETE FROM user_relationships WHERE requester_id=$1 AND target_id=$2`,
      [viewerId, authorId],
    );

    const nextPage = await sync.snapshot(viewerId, {
      snapshotId: firstPage.snapshotId,
      offsets: firstPage.nextOffsets,
      limit: 1,
    });
    expect(nextPage.data.timeline.map((row: any) => row.post_id)).not.toContain(followerPost);
    expect(nextPage.data.timeline).toEqual([]);
    expect(nextPage.hasMore).toBe(false);
  });

  it('revalidates public timeline content after a block is created', async () => {
    await createTimelinePost('public', '2026-11-21T12:00:00Z', ownerId);
    const blockedAuthorPost = await createTimelinePost('public', '2026-11-21T11:00:00Z');

    const firstPage = await sync.snapshot(viewerId, { sections: ['timeline'], limit: 1 });
    expect(firstPage.data.timeline).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);

    await pool.query(
      `INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)`,
      [viewerId, authorId],
    );

    const nextPage = await sync.snapshot(viewerId, {
      snapshotId: firstPage.snapshotId,
      offsets: firstPage.nextOffsets,
      limit: 1,
    });
    expect(nextPage.data.timeline.map((row: any) => row.post_id)).not.toContain(blockedAuthorPost);
    expect(nextPage.data.timeline).toEqual([]);
    expect(nextPage.hasMore).toBe(false);
  });

});
