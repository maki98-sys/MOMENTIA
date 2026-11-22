import { Global, Logger, Module } from '@nestjs/common';
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
      useFactory: (config: ConfigService) => {
        const boundedNumber=(key:string,fallback:number,min:number,max:number)=>{
          const value=Number(config.get(key,fallback));
          return Number.isInteger(value)&&value>=min&&value<=max?value:fallback;
        };
        const pool=new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: boundedNumber('DATABASE_POOL_MAX',10,1,50),
          ssl: config.get<boolean>('DATABASE_SSL', false)
            ? { rejectUnauthorized: true }
            : false,
          application_name: 'momentia-api',
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
          statement_timeout: boundedNumber('DATABASE_STATEMENT_TIMEOUT_MS',60_000,1_000,180_000),
          query_timeout: boundedNumber('DATABASE_QUERY_TIMEOUT_MS',65_000,1_000,240_000),
          options: `-c idle_in_transaction_session_timeout=${boundedNumber('DATABASE_IDLE_TRANSACTION_TIMEOUT_MS',30_000,1_000,300_000)}`,
        });
        pool.on('error',(error:Error)=>{
          Logger.error('Unexpected idle PostgreSQL client error',error.stack,'DatabasePool');
        });
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
