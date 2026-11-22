import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { SyncService } from '../src/sync/sync.service';
import { MembershipsService } from '../src/memberships/memberships.service';

describe('Sync snapshot authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for sync snapshot e2e tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const sync = new SyncService(db);
  const memberships = new MembershipsService(db);

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

  async function createTimelinePost(audience: 'public' | 'followers' | 'space', occurredAt: string, postAuthorId = authorId) {
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

  it('revalidates public timeline content after its audience becomes private', async () => {
    await createTimelinePost('public', '2026-11-21T12:00:00Z', ownerId);
    const restrictedPost = await createTimelinePost('public', '2026-11-21T11:00:00Z');

    const firstPage = await sync.snapshot(viewerId, { sections: ['timeline'], limit: 1 });
    expect(firstPage.data.timeline).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);

    await pool.query(`UPDATE posts SET audience='private' WHERE id=$1`, [restrictedPost]);

    const nextPage = await sync.snapshot(viewerId, {
      snapshotId: firstPage.snapshotId,
      offsets: firstPage.nextOffsets,
      limit: 1,
    });
    expect(nextPage.data.timeline.map((row: any) => row.post_id)).not.toContain(restrictedPost);
    expect(nextPage.data.timeline).toEqual([]);
    expect(nextPage.hasMore).toBe(false);
  });


  it('orders authorization mutations after an in-flight snapshot read lock', async () => {
    const snapshotClient = await pool.connect();
    let mutation: Promise<any> | undefined;
    try {
      await snapshotClient.query('BEGIN');
      await snapshotClient.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))",
      );

      mutation = pool.query(
        `UPDATE space_memberships SET state='left',left_at=now()
         WHERE space_id=$1 AND user_id=$2 AND state='active'`,
        [spaceId, viewerId],
      );

      let waiting = false;
      const deadline = Date.now() + 3000;
      while (!waiting && Date.now() < deadline) {
        const locks = await pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks l
             JOIN pg_stat_activity a ON a.pid=l.pid
             WHERE l.locktype='advisory' AND NOT l.granted
               AND a.query LIKE 'UPDATE space_memberships SET state%'
           ) AS waiting`,
        );
        waiting = locks.rows[0].waiting === true;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
    } finally {
      await snapshotClient.query('COMMIT').catch(() => undefined);
      snapshotClient.release();
    }

    if (!mutation) throw new Error('Authorization mutation did not start.');
    const changed = await mutation;
    expect(changed.rowCount).toBe(1);
  });


  it('takes the authorization write lock before membership row locks', async () => {
    const snapshotClient = await pool.connect();
    const probeClient = await pool.connect();
    let mutation: Promise<any> | undefined;
    try {
      await snapshotClient.query('BEGIN');
      await snapshotClient.query(
        "SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))",
      );

      mutation = memberships.changeRole(ownerId, spaceId, viewerId, 'moderator');
      let waiting = false;
      const deadline = Date.now() + 3000;
      while (!waiting && Date.now() < deadline) {
        const locks = await pool.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_locks l
             JOIN pg_stat_activity a ON a.pid=l.pid
             WHERE l.locktype='advisory' AND NOT l.granted
               AND a.query LIKE 'SELECT pg_advisory_xact_lock%'
           ) AS waiting`,
        );
        waiting = locks.rows[0].waiting === true;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);

      await probeClient.query('BEGIN');
      await probeClient.query(
        `SELECT user_id FROM space_memberships
         WHERE space_id=$1 AND user_id=$2 FOR UPDATE NOWAIT`,
        [spaceId, viewerId],
      );
      await probeClient.query('COMMIT');
    } finally {
      await probeClient.query('ROLLBACK').catch(() => undefined);
      probeClient.release();
      await snapshotClient.query('COMMIT').catch(() => undefined);
      snapshotClient.release();
    }

    if (!mutation) throw new Error('Membership mutation did not start.');
    await expect(mutation).resolves.toMatchObject({role:'moderator',user_id:viewerId});
  });


  it('captures the sync change cursor before reading snapshot sections', async () => {
    const statements: string[] = [];
    const recordingDatabase = {
      query: db.query.bind(db),
      transaction: (work: any) => db.transaction((client: any) => work({
        query: (sql: string, values?: unknown[]) => {
          statements.push(sql);
          return client.query(sql, values);
        },
      })),
    };
    const recordingSync = new SyncService(recordingDatabase as any);
    const snapshot = await recordingSync.snapshot(viewerId, { sections: ['timeline'], limit: 100 });
    const saved = await pool.query('SELECT data FROM sync_snapshot_sessions WHERE id=$1',[snapshot.snapshotId]);
    expect(saved.rows[0].data).toEqual({});

    const cursorIndex = statements.findIndex(sql => sql.includes('MAX(sequence_id'));
    const timelineIndex = statements.findIndex(sql => sql.includes('FROM timeline_entries t'));
    expect(cursorIndex).toBeGreaterThanOrEqual(0);
    expect(timelineIndex).toBeGreaterThan(cursorIndex);
  });


  it('excludes posts and timeline entries from suspended authors', async () => {
    const suspendedPost = await createTimelinePost('public', '2026-11-21T09:00:00Z');
    await pool.query(`UPDATE users SET status='suspended' WHERE id=$1`, [authorId]);

    const snapshot = await sync.snapshot(viewerId, { sections: ['posts', 'timeline'], limit: 100 });
    expect(snapshot.data.posts.map((row: any) => row.id)).not.toContain(suspendedPost);
    expect(snapshot.data.timeline.map((row: any) => row.post_id)).not.toContain(suspendedPost);
  });


  it('never exposes historical sync payloads that may outlive their authorization', async () => {
    const postId = await createTimelinePost('public', '2026-11-21T08:00:00Z',ownerId);
    const pulled = await sync.pull(ownerId, '0', 100);
    const change = pulled.changes.find((row: any) => row.entity_id === postId);
    expect(change).toBeDefined();
    expect(change.payload).toBeNull();
    expect(pulled.refreshRequired).toBe(true);
  });


  it('releases a snapshot and rejects continuation after release', async () => {
    const snapshot = await sync.snapshot(viewerId, { sections: ['profile'] });
    await expect(sync.releaseSnapshot(viewerId,snapshot.snapshotId)).resolves.toEqual({released:true});
    await expect(sync.snapshot(viewerId,{snapshotId:snapshot.snapshotId}))
      .rejects.toThrow('Snapshot session not found or expired.');
  });

  it('rejects a snapshot continuation from another user', async () => {
    const snapshot = await sync.snapshot(viewerId, { sections: ['profile'] });
    await expect(sync.snapshot(ownerId,{snapshotId:snapshot.snapshotId}))
      .rejects.toThrow('Snapshot session not found or expired.');
  });

  it('rejects continuation after snapshot expiry', async () => {
    const snapshot = await sync.snapshot(viewerId, { sections: ['profile'] });
    await pool.query(
      `UPDATE sync_snapshot_sessions SET expires_at=now()-interval '1 minute' WHERE id=$1`,
      [snapshot.snapshotId],
    );
    await expect(sync.snapshot(viewerId,{snapshotId:snapshot.snapshotId}))
      .rejects.toThrow('Snapshot session not found or expired.');
  });

  it('keeps at most two active snapshot sessions per user', async () => {
    await sync.snapshot(viewerId,{sections:['profile']});
    await sync.snapshot(viewerId,{sections:['profile']});
    await sync.snapshot(viewerId,{sections:['profile']});
    const count=await pool.query(
      `SELECT count(*)::int AS count FROM sync_snapshot_sessions WHERE user_id=$1`,
      [viewerId],
    );
    expect(count.rows[0].count).toBe(2);
  });


  it('preserves event timeline memories after the space is archived', async () => {
    const archivedPost = await createTimelinePost('space', '2026-11-21T07:00:00Z');
    await pool.query(`UPDATE spaces SET status='archived' WHERE id=$1`,[spaceId]);
    const snapshot = await sync.snapshot(viewerId,{sections:['timeline'],limit:100});
    expect(snapshot.data.timeline.map((row:any)=>row.post_id)).toContain(archivedPost);
  });


  it('serializes membership revocation behind an in-flight authorized snapshot read', async () => {
    const holder=await pool.connect();
    let committed=false;
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('momentia.sync.authorization', 0))");
      let settled=false;
      const mutation=memberships.remove(ownerId,spaceId,viewerId).finally(()=>{settled=true;});
      await new Promise(resolve=>setTimeout(resolve,100));
      expect(settled).toBe(false);
      await holder.query('COMMIT');
      committed=true;
      await expect(mutation).resolves.toMatchObject({user_id:viewerId,state:'removed'});
      expect(settled).toBe(true);
    } finally {
      if(!committed) await holder.query('ROLLBACK');
      holder.release();
    }
  });

});
