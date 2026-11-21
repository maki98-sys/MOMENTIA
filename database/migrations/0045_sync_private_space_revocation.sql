BEGIN;

-- Couple journal ciphertext must be removed from both local caches when either
-- partner leaves. Once membership count drops below two, the journal is no
-- longer accessible to either side.
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
    SELECT NEW.user_id,'couple_journal_entry',j.id,'delete',NULL
    FROM couple_journal_entries j WHERE j.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'couple_details',NEW.space_id,'delete',NULL
    FROM couple_details d WHERE d.space_id=NEW.space_id;

    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT NEW.user_id,'membership',NEW.id,'upsert',
      jsonb_build_object('id',NEW.id,'space_id',NEW.space_id,
        'user_id',NEW.user_id,'role',NEW.role,'state',NEW.state,
        'joined_at',NEW.joined_at,'left_at',NEW.left_at);
  END IF;
  RETURN NEW;
END;
$$;

-- Remove the former partner's cached copy too; the remaining membership is
-- the only active row and must not retain access to a two-person private space.
CREATE OR REPLACE FUNCTION momentia_sync_revoke_couple_peer_cache() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state='active' AND NEW.state<>'active' THEN
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT sm.user_id,'couple_journal_entry',j.id,'delete',NULL
    FROM space_memberships sm
    JOIN couple_journal_entries j ON j.space_id=sm.space_id
    WHERE sm.space_id=NEW.space_id AND sm.user_id<>NEW.user_id
      AND sm.state='active';
    INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
    SELECT sm.user_id,'couple_details',NEW.space_id,'delete',NULL
    FROM space_memberships sm
    JOIN couple_details d ON d.space_id=sm.space_id
    WHERE sm.space_id=NEW.space_id AND sm.user_id<>NEW.user_id
      AND sm.state='active';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER space_memberships_sync_couple_peer_purge
AFTER UPDATE OF state ON space_memberships
FOR EACH ROW
WHEN (OLD.state='active' AND NEW.state<>'active')
EXECUTE FUNCTION momentia_sync_revoke_couple_peer_cache();

INSERT INTO schema_migrations(version) VALUES ('0045_sync_private_space_revocation')
ON CONFLICT(version) DO NOTHING;
COMMIT;
