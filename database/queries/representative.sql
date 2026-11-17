-- Representative read paths. Run after loading development seeds.
ANALYZE users;
ANALYZE spaces;
ANALYZE space_memberships;
ANALYZE posts;
ANALYZE timeline_entries;
ANALYZE notifications;
ANALYZE media_uploads;

EXPLAIN (ANALYZE, BUFFERS)
SELECT space_id, role, state
FROM space_memberships
WHERE user_id = '10000000-0000-4000-8000-000000000001' AND state = 'active';

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, occurred_at, post_id, media_asset_id
FROM timeline_entries
WHERE space_id = '20000000-0000-4000-8000-000000000001'
ORDER BY occurred_at DESC, id
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, author_id, published_at
FROM posts
WHERE space_id = '20000000-0000-4000-8000-000000000001' AND status = 'published'
ORDER BY published_at DESC
LIMIT 30;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, state, updated_at
FROM media_uploads
WHERE state IN ('created','uploading','uploaded','processing')
ORDER BY updated_at
LIMIT 100;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, category, created_at
FROM notifications
WHERE user_id = '10000000-0000-4000-8000-000000000001' AND read_at IS NULL
ORDER BY created_at DESC
LIMIT 30;
