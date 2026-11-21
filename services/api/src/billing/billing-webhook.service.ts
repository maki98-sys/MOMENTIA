import { BadRequestException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED=new Set(['subscription.activated','subscription.updated','subscription.cancelled','subscription.payment_failed','subscription.expired']);
type EventData={userId:string;planCode:string;subscriptionId:string;customerId?:string;status?:'trialing'|'active'|'past_due'|'cancelled'|'expired';periodStart?:string|null;periodEnd?:string|null;cancelAtPeriodEnd?:boolean;occurredAt?:string};

@Injectable()
export class BillingWebhookService {
  constructor(private readonly db:DatabaseService) {}

  private validatePayload(payload:unknown):EventData {
    if(!payload||typeof payload!=='object'||Array.isArray(payload)) throw new BadRequestException('Billing event payload must be an object.');
    const v=payload as Record<string,unknown>;
    if(typeof v.userId!=='string'||!UUID.test(v.userId)||typeof v.planCode!=='string'||!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(v.planCode)||typeof v.subscriptionId!=='string'||!v.subscriptionId.trim()||v.subscriptionId.length>255) throw new BadRequestException('Billing event subscription identity is invalid.');
    for(const k of ['periodStart','periodEnd']) if(v[k]!==undefined&&v[k]!==null&&(typeof v[k]!=='string'||!Number.isFinite(Date.parse(v[k] as string)))) throw new BadRequestException(`Invalid ${k} date.`);
    if(v.periodStart&&v.periodEnd&&Date.parse(v.periodEnd as string)<=Date.parse(v.periodStart as string)) throw new BadRequestException('Subscription period end must be after period start.');
    if(v.customerId!==undefined&&(typeof v.customerId!=='string'||v.customerId.length>255)) throw new BadRequestException('Invalid customerId.');
    if(v.cancelAtPeriodEnd!==undefined&&typeof v.cancelAtPeriodEnd!=='boolean') throw new BadRequestException('cancelAtPeriodEnd must be boolean.');
    if(v.occurredAt!==undefined&&(typeof v.occurredAt!=='string'||!Number.isFinite(Date.parse(v.occurredAt)))) throw new BadRequestException('Invalid occurredAt event timestamp.');
    if(v.status!==undefined&&!['trialing','active','past_due','cancelled','expired'].includes(String(v.status))) throw new BadRequestException('Invalid subscription status.');
    return v as unknown as EventData;
  }

  // Provider adapters must verify signature, timestamp and event identity before calling this method.
  async ingestVerifiedEvent(provider:string,eventId:string,eventType:string,payload:unknown) {
    if(!/^[a-z][a-z0-9_-]{1,39}$/.test(provider)||!eventId||eventId.length>255||!eventType||eventType.length>120) throw new BadRequestException('Invalid provider event metadata.');
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Buffer.byteLength(JSON.stringify(payload))>32000) throw new BadRequestException('Payload must be an object up to 32 KB.');
    const inserted=await this.db.query(`INSERT INTO billing_webhook_events(provider,provider_event_id,event_type,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(provider,provider_event_id) DO NOTHING RETURNING id,processing_status,received_at`,[provider,eventId,eventType,JSON.stringify(payload)]);
    if(inserted.rowCount) return {accepted:true,duplicate:false,event:inserted.rows[0]};
    const prior=await this.db.query(`SELECT id,processing_status,received_at FROM billing_webhook_events WHERE provider=$1 AND provider_event_id=$2`,[provider,eventId]);
    return {accepted:true,duplicate:true,event:prior.rows[0]??null};
  }

  async claimBatch(limit=30) {
    const size=Math.min(Math.max(Number(limit)||30,1),100);
    return this.db.transaction(async client=>{
      const r=await client.query(`WITH candidates AS (
        SELECT id FROM billing_webhook_events WHERE processing_status IN ('received','failed') AND next_attempt_at<=now() AND attempts<10
        ORDER BY next_attempt_at,received_at,id LIMIT $1 FOR UPDATE SKIP LOCKED
      ) UPDATE billing_webhook_events e SET processing_status='processing',attempts=e.attempts+1,processing_started_at=now(),updated_at=now(),processing_error=NULL
      FROM candidates c WHERE e.id=c.id RETURNING e.id,e.provider,e.provider_event_id,e.event_type,e.payload,e.attempts`,[size]);
      return r.rows;
    });
  }

  private async apply(client:PoolClient,e:Record<string,any>) {
    if(!SUPPORTED.has(String(e.event_type))) {
      await client.query(`UPDATE billing_webhook_events SET processing_status='ignored',processing_started_at=NULL,processed_at=now(),updated_at=now() WHERE id=$1`,[e.id]); return;
    }
    const d=this.validatePayload(e.payload), type=String(e.event_type), provider=String(e.provider);
    let status:string=d.status??'active', cancel=d.cancelAtPeriodEnd??false;
    if(type==='subscription.cancelled') status=cancel?(d.status==='trialing'?'trialing':'active'):'cancelled';
    if(type==='subscription.payment_failed') status='past_due';
    if(type==='subscription.expired'){status='expired';cancel=false;}
    const plan=await client.query(`SELECT id FROM subscription_plans WHERE code=$1`,[d.planCode]);
    if(!plan.rowCount) throw new BadRequestException('Unknown subscription plan.');
    const user=await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`,[d.userId]);
    if(!user.rowCount) throw new BadRequestException('Unknown subscription user.');
    const existing=await client.query(`SELECT id,user_id,last_provider_event_at FROM user_subscriptions WHERE provider=$1 AND provider_subscription_id=$2 FOR UPDATE`,[provider,d.subscriptionId]);
    if(existing.rowCount && existing.rows[0].user_id!==d.userId) throw new BadRequestException('Provider subscription is already linked to a different user.');
    const eventAt=d.occurredAt?new Date(d.occurredAt):null;
    const previousEventAt=existing.rows[0]?.last_provider_event_at?new Date(existing.rows[0].last_provider_event_at):null;
    if(eventAt && previousEventAt && eventAt.getTime()<=previousEventAt.getTime()) {
      await client.query(`UPDATE billing_webhook_events SET processing_status='ignored',processing_started_at=NULL,processed_at=now(),processing_error='STALE_PROVIDER_EVENT',updated_at=now() WHERE id=$1`,[e.id]);
      return;
    }
    const params=[d.userId,plan.rows[0].id,status,provider,d.customerId??null,d.subscriptionId,d.periodStart??null,d.periodEnd??null,cancel];
    if(['trialing','active','past_due'].includes(status)) await client.query(
      `UPDATE user_subscriptions SET status='cancelled',cancel_at_period_end=false,updated_at=now()
       WHERE user_id=$1 AND status IN ('trialing','active','past_due')
         AND NOT (provider=$2 AND provider_subscription_id=$3)`,
      [d.userId,provider,d.subscriptionId],
    );
    if(existing.rowCount) {
      await client.query(`UPDATE user_subscriptions SET user_id=$1,plan_id=$2,status=$3,provider=$4,provider_customer_id=$5,provider_subscription_id=$6,current_period_start=$7,current_period_end=$8,cancel_at_period_end=$9,last_provider_event_at=COALESCE($10,last_provider_event_at),updated_at=now() WHERE id=$11`,[...params,eventAt,existing.rows[0].id]);
    } else {
      await client.query(`INSERT INTO user_subscriptions(user_id,plan_id,status,provider,provider_customer_id,provider_subscription_id,current_period_start,current_period_end,cancel_at_period_end,last_provider_event_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...params,eventAt]);
    }
    await client.query(`UPDATE billing_webhook_events SET processing_status='processed',processing_started_at=NULL,processed_at=now(),processing_error=NULL,updated_at=now() WHERE id=$1`,[e.id]);
  }

  async processBatch(limit=30) {
    const events=await this.claimBatch(limit);let processed=0,ignored=0,failed=0;
    for(const e of events) try {
      await this.db.transaction(client=>this.apply(client,e));
      const state=await this.db.query(`SELECT processing_status FROM billing_webhook_events WHERE id=$1`,[e.id]);
      if(state.rows[0]?.processing_status==='ignored') ignored++; else processed++;
    } catch(err) {
      failed++;const msg=err instanceof Error?err.message:'Unknown billing webhook error';
      await this.db.query(`UPDATE billing_webhook_events SET
        processing_status=CASE WHEN attempts>=10 THEN 'dead_letter' ELSE 'failed' END,
        processing_error=$2,processing_started_at=NULL,
        next_attempt_at=now()+make_interval(secs=>LEAST(21600,30*(2^LEAST(attempts,9))::integer)),
        updated_at=now()
        WHERE id=$1 AND processing_status='processing'`,[e.id,msg.slice(0,1000)]);
    }
    return {claimed:events.length,processed,ignored,failed};
  }

  async recoverStale(seconds=300) {
    const n=Number(seconds);if(!Number.isSafeInteger(n)||n<60||n>3600) throw new BadRequestException('Timeout must be between 60 and 3600 seconds.');
    const r=await this.db.query(`UPDATE billing_webhook_events SET
      processing_status=CASE WHEN attempts>=10 THEN 'dead_letter' ELSE 'failed' END,
      processing_started_at=NULL,processing_error='PROCESSING_LEASE_EXPIRED',
      next_attempt_at=now(),updated_at=now()
      WHERE processing_status='processing' AND processing_started_at<now()-($1 * interval '1 second') RETURNING id,processing_status`,[n]);
    return {recovered:r.rowCount??0};
  }

  async listDeadLetter(limit=50) {
    const size=Math.min(Math.max(Number(limit)||50,1),100);
    const r=await this.db.query(`SELECT id,provider,provider_event_id,event_type,processing_error,attempts,received_at,updated_at
      FROM billing_webhook_events WHERE processing_status='dead_letter'
      ORDER BY updated_at DESC,id DESC LIMIT $1`,[size]);
    return {items:r.rows};
  }

  async retryDeadLetter(eventId:string) {
    if(!UUID.test(eventId)) throw new BadRequestException('eventId must be a UUID.');
    const r=await this.db.query(`UPDATE billing_webhook_events SET processing_status='received',
      attempts=0,processing_error=NULL,processing_started_at=NULL,next_attempt_at=now(),updated_at=now()
      WHERE id=$1 AND processing_status='dead_letter'
      RETURNING id,provider,provider_event_id,event_type,processing_status`,[eventId]);
    if(!r.rowCount) throw new BadRequestException('Dead-letter event not found or not retryable.');
    return {retried:true,event:r.rows[0]};
  }
}
