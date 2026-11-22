import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { SocialService } from '../src/social/social.service';

describe('Social post authorization (PostgreSQL)', () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for social authorization E2E tests.');

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const db = new DatabaseService(pool);
  const social = new SocialService(db);
  let authorId: string;
  let viewerId: string;

  beforeEach(async () => {
    authorId = randomUUID();
    viewerId = randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active'),($3,$4,'active')`,
      [authorId, `social-author-${authorId}@momentia.test`, viewerId, `social-viewer-${viewerId}@momentia.test`],
    );
  });

  afterEach(async () => {
    await pool.query('DELETE FROM user_blocks WHERE blocker_id=ANY($1::uuid[]) OR blocked_id=ANY($1::uuid[])', [[authorId, viewerId]]);
    await pool.query('DELETE FROM user_relationships WHERE requester_id=ANY($1::uuid[]) OR target_id=ANY($1::uuid[])', [[authorId, viewerId]]);
    await pool.query('DELETE FROM posts WHERE author_id=ANY($1::uuid[])', [[authorId, viewerId]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[authorId, viewerId]]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('allows a different user to comment on a published public post', async () => {
    const post = await social.create(authorId, { body: 'Public authorization fixture', audience: 'public' });
    const comment = await social.addComment(viewerId, post.id, 'A permitted comment');
    expect(comment).toMatchObject({ post_id: post.id, author_id: viewerId, body: 'A permitted comment' });
  });

  it('does not allow a different user to comment on a private post', async () => {
    const post = await social.create(authorId, { body: 'Private authorization fixture', audience: 'private' });
    await expect(social.addComment(viewerId, post.id, 'Must not be stored'))
      .rejects.toThrow('Post not found.');
    const comments = await pool.query('SELECT id FROM post_comments WHERE post_id=$1', [post.id]);
    expect(comments.rows).toHaveLength(0);
  });

  it('revokes access to a public post when either user blocks the other', async () => {
    const post = await social.create(authorId, { body: 'Blocked authorization fixture', audience: 'public' });
    await social.block(viewerId, authorId);
    await expect(social.comments(viewerId, post.id)).rejects.toThrow('Post not found.');
    await expect(social.addComment(viewerId, post.id, 'Must not be stored'))
      .rejects.toThrow('Post not found.');
    const comments = await pool.query('SELECT id FROM post_comments WHERE post_id=$1', [post.id]);
    expect(comments.rows).toHaveLength(0);
  });
});
