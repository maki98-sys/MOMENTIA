BEGIN;

CREATE OR REPLACE FUNCTION momentia_sync_couple_journal_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  entry couple_journal_entries%ROWTYPE;
  change_kind text;
BEGIN
  IF TG_OP='DELETE' THEN
    entry:=OLD;
    change_kind:='delete';
  ELSE
    entry:=NEW;
    change_kind:=CASE WHEN NEW.deleted_at IS NULL THEN 'upsert' ELSE 'delete' END;
  END IF;

  INSERT INTO sync_change_log(user_id,entity_type,entity_id,change_type,payload)
  SELECT sm.user_id,'couple_journal_entry',entry.id,change_kind,
    CASE WHEN change_kind='upsert' THEN jsonb_build_object(
      'id',entry.id,'space_id',entry.space_id,'author_id',entry.author_id,
      'ciphertext',encode(entry.ciphertext,'base64'),'nonce',encode(entry.nonce,'base64'),
      'encryption_version',entry.encryption_version,'key_version',entry.key_version,
      'created_at',entry.created_at,'updated_at',entry.updated_at
    ) ELSE NULL END
  FROM space_memberships sm
  JOIN spaces s ON s.id=sm.space_id
  WHERE sm.space_id=entry.space_id AND sm.state='active'
    AND s.type='COUPLE' AND s.status='active'
    AND (SELECT count(*) FROM space_memberships active_members
         WHERE active_members.space_id=entry.space_id AND active_members.state='active')=2;

  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

CREATE TRIGGER couple_journal_sync_insert
AFTER INSERT ON couple_journal_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_journal_change();
CREATE TRIGGER couple_journal_sync_update
AFTER UPDATE OF ciphertext,nonce,encryption_version,key_version,deleted_at ON couple_journal_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_journal_change();
CREATE TRIGGER couple_journal_sync_delete
AFTER DELETE ON couple_journal_entries
FOR EACH ROW EXECUTE FUNCTION momentia_sync_couple_journal_change();

INSERT INTO schema_migrations(version) VALUES ('0034_sync_encrypted_couple_journal')
ON CONFLICT (version) DO NOTHING;
COMMIT;
