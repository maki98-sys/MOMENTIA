BEGIN;

-- When a member loses access, remove all previously synchronized space-scoped
-- entities from that member's local cache. The tombstones are private to the
-- revoked member; remaining active members retain their normal sync stream.
CREATE OR REPLACE FUNCTION momentia_sync_revoke_space_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='active' AND NEW.state<>'active' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'space',NEW.space_id,'delete',NULL;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'album_item',i.id,'delete',NULL
    FROM space_album_items i
    JOIN space_albums a ON a.id=i.album_id
    WHERE a.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'timeline_entry',t.id,'delete',NULL
    FROM timeline_entries t WHERE t.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'post',p.id,'delete',NULL
    FROM posts p WHERE p.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'comment',c.id,'delete',NULL
    FROM post_comments c JOIN posts p ON p.id=c.post_id
    WHERE p.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'event_rsvp',r.id,'delete',NULL
    FROM event_rsvps r WHERE r.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'membership',NEW.id,'upsert',
      jsonb_build_object('id',NEW.id,'space_id',NEW.space_id,
        'user_id',NEW.user_id,'role',NEW.role,'state',NEW.state,
        'joined_at',NEW.joined_at,'left_at',NEW.left_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER space_memberships_sync_revocation
AFTER UPDATE OF state ON space_memberships
FOR EACH ROW
WHEN (OLD.state='active' AND NEW.state<>'active')
EXECUTE FUNCTION momentia_sync_revoke_space_cache();

INSERT INTO schema_migrations(version) VALUES ('0040_sync_membership_revocation_purge')
ON CONFLICT(version) DO NOTHING;
COMMIT;
