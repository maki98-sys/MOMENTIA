import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { DatabaseService } from '../src/database/database.service';
import { PrivacyService } from '../src/privacy/privacy.service';

describe('PrivacyService PostgreSQL lifecycle',()=>{
  let pool:Pool;
  let database:DatabaseService;
  let service:PrivacyService;
  let userId:string;

  beforeAll(()=>{
    if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for privacy E2E tests.');
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
    database=new DatabaseService(pool);
    service=new PrivacyService(database);
  });

  beforeEach(async()=>{
    userId=randomUUID();
    await pool.query(
      `INSERT INTO users(id,email_normalized,status)
       VALUES($1,$2,'active')`,
      [userId,`privacy-${userId}@momentia.test`],
    );
  });

  afterEach(async()=>{
    if(!userId) return;
    await pool.query(
      'DELETE FROM user_audit_events WHERE actor_id=$1 OR subject_user_id=$1',
      [userId],
    );
    await pool.query('DELETE FROM account_deletion_requests WHERE user_id=$1',[userId]);
    await pool.query('DELETE FROM users WHERE id=$1',[userId]);
  });

  afterAll(async()=>{await pool?.end();});

  it('executes the complete personal-data export query set against PostgreSQL',async()=>{
    const exported=await service.exportMyData(userId);
    expect(exported.format).toBe('momentia-data-export-v1');
    expect(exported.consistency).toBe('repeatable_read');
    expect(exported.data.account).toHaveLength(1);
    expect(exported.data.account[0].id).toBe(userId);
    expect(exported.data.coupleJournalEntries).toEqual([]);
    expect(exported.data.audioParticipations).toEqual([]);
    expect(Object.keys(exported.data).length).toBeGreaterThan(35);
  });

  it('requests deletion and permits cancellation during the grace period',async()=>{
    const request=await service.requestDeletion(userId);
    expect(request.status).toBe('pending');
    const pending=await pool.query('SELECT status FROM users WHERE id=$1',[userId]);
    expect(pending.rows[0].status).toBe('deletion_pending');
    const cancelled=await service.cancelDeletion(userId);
    expect(cancelled).toMatchObject({cancelled:true,requestId:request.id});
    const account=await pool.query('SELECT status FROM users WHERE id=$1',[userId]);
    expect(account.rows[0].status).toBe('active');
  });

  it('claims and completes an account purge after media and storage checks pass',async()=>{
    const request=await service.requestDeletion(userId);
    await pool.query(
      'UPDATE account_deletion_requests SET scheduled_for=now() WHERE id=$1',
      [request.id],
    );
    const worker='privacy-e2e-worker';
    const claimed=await service.claimDueDeletionRequests(worker,5);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({id:request.id,user_id:userId});
    const completed=await service.completeDeletionRequest(worker,request.id,{success:true,purged:true});
    expect(completed).toMatchObject({id:request.id,status:'completed'});
    const account=await pool.query('SELECT status,email_normalized FROM users WHERE id=$1',[userId]);
    expect(account.rows[0].status).toBe('deleted');
    expect(account.rows[0].email_normalized).toBe(`deleted+${userId}@deleted.invalid`);
  });
});
