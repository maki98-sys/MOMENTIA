import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BillingService {
  constructor(private readonly db: DatabaseService) {}

  async listPlans() {
    const result = await this.db.query(
      `SELECT code,display_name,monthly_price_minor,currency,
              storage_quota_bytes,max_upload_bytes,features
       FROM subscription_plans
       WHERE is_public=true
       ORDER BY monthly_price_minor,code`,
    );
    return result.rows;
  }

  async getEntitlements(userId: string) {
    const result = await this.db.query(
      `SELECT p.code plan_code,p.display_name plan_name,p.monthly_price_minor,
              p.currency,p.storage_quota_bytes,p.max_upload_bytes,p.features,
              COALESCE(s.status,'active') subscription_status,
              s.current_period_end,s.cancel_at_period_end,
              COALESCE(usage.used_bytes,0)::bigint used_bytes,
              COALESCE(usage.asset_count,0)::int asset_count,
              COALESCE(usage.pending_bytes,0)::bigint pending_bytes,
              COALESCE(usage.ready_bytes,0)::bigint ready_bytes
       FROM subscription_plans p
       LEFT JOIN LATERAL (
         SELECT us.status,us.current_period_end,us.cancel_at_period_end,us.plan_id
         FROM user_subscriptions us
         WHERE us.user_id=$1
           AND us.status IN ('trialing','active','past_due')
           AND (us.current_period_end IS NULL OR us.current_period_end>now())
         ORDER BY CASE us.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
                  us.created_at DESC
         LIMIT 1
       ) s ON s.plan_id=p.id
       LEFT JOIN LATERAL (
         SELECT (
                  COALESCE(sum(a.size_bytes),0)
                  + COALESCE((SELECT sum(v.size_bytes)
                              FROM media_variants v
                              JOIN media_assets va ON va.id=v.media_asset_id
                              WHERE va.owner_id=$1 AND va.status<>'deleted'),0)
                )::bigint used_bytes,
                count(*)::int asset_count,
                COALESCE(sum(a.size_bytes) FILTER (WHERE a.status IN ('pending','quarantined','processing')),0)::bigint pending_bytes,
                (
                  COALESCE(sum(a.size_bytes) FILTER (WHERE a.status='ready'),0)
                  + COALESCE((SELECT sum(v.size_bytes)
                              FROM media_variants v
                              JOIN media_assets va ON va.id=v.media_asset_id
                              WHERE va.owner_id=$1 AND va.status='ready'),0)
                )::bigint ready_bytes
         FROM media_assets a
         WHERE a.owner_id=$1 AND a.status<>'deleted'
       ) usage ON true
       WHERE p.code=COALESCE(
         (SELECT sp.code FROM subscription_plans sp WHERE sp.id=s.plan_id),
         'free'
       )`,
      [userId],
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const quota = BigInt(row.storage_quota_bytes);
    const used = BigInt(row.used_bytes);
    const remaining = quota > used ? quota - used : 0n;
    return {
      ...row,
      storage_quota_bytes: quota.toString(),
      used_bytes: used.toString(),
      remaining_bytes: remaining.toString(),
      asset_count: Number(row.asset_count),
      pending_bytes: BigInt(row.pending_bytes).toString(),
      ready_bytes: BigInt(row.ready_bytes).toString(),
      storage_usage_percent: quota > 0n
        ? Math.min(100, Number((used * 10000n) / quota) / 100)
        : 0,
      features: row.features ?? {},
    };
  }
}
