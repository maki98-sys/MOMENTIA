#!/usr/bin/env python3
"""Smoke tests for MOMENTIA's local SQLite schema; uses Python stdlib only."""
from pathlib import Path
import sqlite3

schema = Path(__file__).with_name("0001_local_schema.sql").read_text(encoding="utf-8")
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(schema)

# Authentication secrets belong in Keychain/Keystore, never in SQLite.
for (table_name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    columns = [row[1].lower() for row in db.execute(f'PRAGMA table_info("{table_name}")')]
    forbidden = ("token", "secret", "password", "credential", "authorization")
    leaked = [column for column in columns if any(term in column for term in forbidden)]
    assert not leaked, f"Authentication secret-like columns found in {table_name}: {leaked}"

# Verify offline photo capture and durable outbox persistence.
db.execute("INSERT INTO local_media_assets(local_id,file_uri,mime_type,size_bytes) VALUES (?,?,?,?)",
           ("local-photo-1","file:///local/photo.jpg","image/jpeg",1024))
db.execute("""INSERT INTO outbox_operations
(id,operation_type,aggregate_type,aggregate_local_id,payload_json,idempotency_key)
VALUES (?,?,?,?,?,?)""",
           ("op-1","media.upload","media","local-photo-1",'{"localId":"local-photo-1"}',"idem-1"))
assert db.execute("SELECT count(*) FROM outbox_operations WHERE state='pending'").fetchone()[0] == 1

# A repeated idempotency key must be rejected.
try:
    db.execute("""INSERT INTO outbox_operations
    (id,operation_type,aggregate_type,aggregate_local_id,payload_json,idempotency_key)
    VALUES (?,?,?,?,?,?)""",
               ("op-2","media.upload","media","local-photo-1",'{"localId":"local-photo-1"}',"idem-1"))
    raise AssertionError("duplicate idempotency key was accepted")
except sqlite3.IntegrityError:
    pass

# Invalid state and GPS metadata without consent must be rejected.
for statement, params in [
    ("INSERT INTO local_media_assets(local_id,file_uri,mime_type,size_bytes,upload_state) VALUES (?,?,?,?,?)",
     ("bad-state","file:///bad.jpg","image/jpeg",10,"unknown")),
    ("INSERT INTO local_media_assets(local_id,file_uri,mime_type,size_bytes,gps_ciphertext) VALUES (?,?,?,?,?)",
     ("bad-gps","file:///gps.jpg","image/jpeg",10,b"secret")),
]:
    try:
        db.execute(statement, params)
        raise AssertionError("invalid local media row was accepted")
    except sqlite3.IntegrityError:
        pass

# Foreign-key enforcement must be active.
try:
    db.execute("INSERT INTO cached_space_memberships(space_id,user_id,role,state,server_updated_at) VALUES (?,?,?,?,?)",
               ("missing-space","user-1","member","active","2026-01-01T00:00:00Z"))
    raise AssertionError("orphan membership was accepted")
except sqlite3.IntegrityError:
    pass

print("SQLite schema smoke tests and auth-secret column audit: PASS")
