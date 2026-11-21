import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class BillingService {
  constructor(private readonly db: DatabaseService) {}

  async listPlans() {
    const result = await this.db.query(
      `SELECT code,display_name,money.monthly_price_minor,currency,
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
              COALESCE(usage.used_bytes,0)::bigint used_bytes
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
         SELECT COALESCE(sum(a.size_bytes),0)::bigint used_bytes
         FROM media_assets a
         WHERE a.owner_id=$1 AND a.status<>'deleted'
       ) usage ON true
       WHERE p.code=COALESCE(
         (SELECT sp.code FROM subscription_plans sp WHERE sp.id=s.plan_id),
         'free'
       )`,
      [userId],
    );
    return result.rows[0] ?? null;
  }
}
