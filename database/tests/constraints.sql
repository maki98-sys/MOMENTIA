-- Run after all migrations with psql -v ON_ERROR_STOP=1 -f database/tests/constraints.sql
-- This script rolls back all fixtures.
BEGIN;

DO $$
DECLARE
 u1 uuid; u2 uuid; s uuid; invalid_space uuid; caught boolean := false;
BEGIN
 INSERT INTO users(email_normalized,status) VALUES ('db-test-one@momentia.invalid','active') RETURNING id INTO u1;
 INSERT INTO users(email_normalized,status) VALUES ('db-test-two@momentia.invalid','active') RETURNING id INTO u2;

 -- Valid couple: the subtype and both memberships exist before deferred checks fire.
 INSERT INTO spaces(type,owner_id,name) VALUES ('COUPLE',u1,'valid test couple') RETURNING id INTO s;
 INSERT INTO couple_details(space_id) VALUES (s);
 INSERT INTO space_memberships(space_id,user_id,role,state,joined_at) VALUES
  (s,u1,'owner','active',now()), (s,u2,'member','active',now());
 SET CONSTRAINTS ALL IMMEDIATE;

 -- Invalid couple: committing a single active member must fail.
 BEGIN
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO spaces(type,owner_id,name) VALUES ('COUPLE',u1,'invalid test couple') RETURNING id INTO invalid_space;
  INSERT INTO couple_details(space_id) VALUES (invalid_space);
  INSERT INTO space_memberships(space_id,user_id,role,state,joined_at)
   VALUES (invalid_space,u1,'owner','active',now());
  SET CONSTRAINTS ALL IMMEDIATE;
 EXCEPTION WHEN check_violation THEN
  caught := true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Expected COUPLE exact-two-members constraint to reject one member'; END IF;
END $$;

ROLLBACK;
