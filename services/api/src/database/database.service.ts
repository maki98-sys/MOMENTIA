import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient, QueryResult } from 'pg';
import { DATABASE_POOL } from './database.constants';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, values);
  }

  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discardClient=false;
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // A connection that cannot roll back must not be returned to the pool.
        discardClient=true;
      }
      throw error;
    } finally {
      if(discardClient) client.release(new Error('PostgreSQL transaction rollback failed.'));
      else client.release();
    }
  }

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
