#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt <<'SQL' > /tmp/momentia-concurrency-fixture.txt
WITH
owner_user AS (INSERT INTO users(email_normalized,status) VALUES ('race-owner@momentia.invalid','active') RETURNING id),
member_user AS (INSERT INTO users(email_normalized,status) VALUES ('race-member@momentia.invalid','active') RETURNING id),
extra_user_a AS (INSERT INTO users(email_normalized,status) VALUES ('race-extra-a@momentia.invalid','active') RETURNING id),
extra_user_b AS (INSERT INTO users(email_normalized,status) VALUES ('race-extra-b@momentia.invalid','active') RETURNING id),
new_space AS (INSERT INTO spaces(type,owner_id,name) SELECT 'COUPLE',id,'race-condition-test' FROM owner_user RETURNING id),
subtype AS (INSERT INTO couple_details(space_id) SELECT id FROM new_space RETURNING space_id),
owner_membership AS (INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) SELECT subtype.space_id,owner_user.id,'owner','active',now() FROM subtype CROSS JOIN owner_user RETURNING id),
member_membership AS (INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) SELECT subtype.space_id,member_user.id,'member','active',now() FROM subtype CROSS JOIN member_user RETURNING id)
SELECT (SELECT id FROM new_space) || '|' ||
       (SELECT id FROM owner_user) || '|' ||
       (SELECT id FROM member_user) || '|' ||
       (SELECT id FROM extra_user_a) || '|' ||
       (SELECT id FROM extra_user_b);
SQL
IFS='|' read -r SPACE OWNER MEMBER EXTRA_A EXTRA_B < /tmp/momentia-concurrency-fixture.txt

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) VALUES ('$SPACE','$EXTRA_A','member','active',now()); SELECT pg_sleep(1); COMMIT;" >/tmp/momentia-race-a.log 2>&1 &
PID_A=$!
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) VALUES ('$SPACE','$EXTRA_B','member','active',now()); SELECT pg_sleep(1); COMMIT;" >/tmp/momentia-race-b.log 2>&1 &
PID_B=$!

if wait "$PID_A"; then echo "Concurrent membership A unexpectedly committed"; exit 1; fi
if wait "$PID_B"; then echo "Concurrent membership B unexpectedly committed"; exit 1; fi
grep -q "exactly 2 active members" /tmp/momentia-race-a.log
grep -q "exactly 2 active members" /tmp/momentia-race-b.log

COUNT=$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM space_memberships WHERE space_id='$SPACE' AND state='active'")
test "$COUNT" = "2"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DELETE FROM spaces WHERE id='$SPACE'"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DELETE FROM users WHERE id IN ('$OWNER','$MEMBER','$EXTRA_A','$EXTRA_B')"
echo "PostgreSQL concurrent COUPLE membership test: PASS"
