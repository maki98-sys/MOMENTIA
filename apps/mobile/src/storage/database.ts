import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'momentia.db';
let databasePromise: Promise<SQLite.SQLiteDatabase> | undefined;

export function getLocalDatabase() {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async db => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS sync_operations (
          operation_id TEXT PRIMARY KEY NOT NULL,
          entity_id TEXT NOT NULL,
          operation_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_version INTEGER NOT NULL DEFAULT 1,
          state TEXT NOT NULL CHECK (state IN (
            'LOCAL_ONLY','QUEUED','UPLOADING','SERVER_PROCESSING',
            'SYNCED','FAILED_RETRYABLE','FAILED_PERMANENT','CANCELLED'
          )),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          dependency_ids_json TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sync_operations_ready_idx
          ON sync_operations(state, next_retry_at, created_at);
        CREATE TABLE IF NOT EXISTS cached_entities (
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          server_version INTEGER,
          cached_at TEXT NOT NULL,
          PRIMARY KEY(entity_type, entity_id)
        );
      `);
      return db;
    });
  }
  return databasePromise;
}
