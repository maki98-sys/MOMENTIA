-- Synthetic, transaction-scoped query/load smoke test. All rows are rolled back.
-- Requires database/seeds/development.sql to have been applied first.
BEGIN;
SET LOCAL synchronous_commit = off;

INSERT INTO posts(author_id,space_id,body,audience,status,published_at)
SELECT
 '10000000-0000-4000-8000-000000000001'::uuid,
 '20000000-0000-4000-8000-000000000001'::uuid,
 'MOMENTIA_LOAD_TEST:' || n::text,
 'space',
 'published',
 now() - (n || ' seconds')::interval
FROM generate_series(1,10000) AS n;

INSERT INTO timeline_entries(space_id,post_id,occurred_at,source)
SELECT p.space_id,p.id,p.published_at,'post'
FROM posts p
WHERE p.body LIKE 'MOMENTIA_LOAD_TEST:%';

DO $test$
DECLARE loaded_count bigint;
BEGIN
 SELECT count(*) INTO loaded_count
 FROM timeline_entries te
 JOIN posts p ON p.id = te.post_id
 WHERE p.body LIKE 'MOMENTIA_LOAD_TEST:%';
 IF loaded_count <> 10000 THEN
  RAISE EXCEPTION 'Expected 10000 synthetic timeline rows; found %',loaded_count;
 END IF;
END
$test$;

ANALYZE timeline_entries;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id,occurred_at,post_id
FROM timeline_entries
WHERE space_id = '20000000-0000-4000-8000-000000000001'
ORDER BY occurred_at DESC,id
LIMIT 50;

ROLLBACK;
