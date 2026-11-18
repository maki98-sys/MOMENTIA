import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL } from './database.constants';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Pool({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        max: config.get<number>('DATABASE_POOL_MAX', 10),
        ssl: config.get<boolean>('DATABASE_SSL', false)
          ? { rejectUnauthorized: true }
          : false,
        application_name: 'momentia-api',
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
      }),
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
