import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface NotificationCursor {
  createdAt: string;
  id: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DatabaseService) {}

  private decodeCursor(value?: string): NotificationCursor | null {
    if (value === undefined) return null;
    try {
      const decoded = Buffer.from(value, 'base64url').toString('utf8');
      const parsed = JSON.parse(decoded) as Record<string, unknown>;
      if (
        typeof parsed.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(parsed.createdAt)) ||
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.id)
      ) {
        throw new Error('Invalid cursor.');
      }
      return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
    } catch {
      throw new BadRequestException('cursor is invalid.');
    }
  }

  async list(userId: string, cursor?: string, limit = 30, unreadOnly = false) {
    const pageSize = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const decoded = this.decodeCursor(cursor);
    const result = await this.db.query(
      `SELECT id, category, payload, read_at, created_at
       FROM notifications n
       WHERE n.user_id = $1
         AND ($2::timestamptz IS NULL OR (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
         AND ($4::boolean = false OR n.read_at IS NULL)
         AND NOT EXISTS (
           SELECT 1 FROM notification_preferences np
           WHERE np.user_id=n.user_id AND np.category=n.category AND np.in_app_enabled=false
         )
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT $5`,
      [userId, decoded?.createdAt ?? null, decoded?.id ?? null, unreadOnly, pageSize],
    );

    const unread = await this.db.query(
      `SELECT count(*)::int AS count FROM notifications
       WHERE user_id = $1 AND read_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM notification_preferences np
           WHERE np.user_id=notifications.user_id AND np.category=notifications.category AND np.in_app_enabled=false
         )`,
      [userId],
    );
    const last = result.rows[result.rows.length - 1] as Record<string, unknown> | undefined;

    return {
      items: result.rows,
      unreadCount: Number(unread.rows[0]?.count ?? 0),
      nextCursor: result.rows.length === pageSize && last
        ? Buffer.from(JSON.stringify({
            createdAt: new Date(String(last.created_at)).toISOString(),
            id: String(last.id),
          })).toString('base64url')
        : null,
    };
  }

  async markRead(userId: string, notificationId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
      throw new BadRequestException('notificationId must be a UUID.');
    }
    const result = await this.db.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2
       RETURNING id, category, payload, read_at, created_at`,
      [notificationId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('Notification not found.');
    return result.rows[0];
  }

  async markAllRead(userId: string) {
    const result = await this.db.query(
      `UPDATE notifications SET read_at = now()
       WHERE user_id = $1 AND read_at IS NULL`,
      [userId],
    );
    return { updated: result.rowCount ?? 0 };
  }

  async createForUser(userId: string, category: string, payload: Record<string, unknown>, dedupeKey?: string) {
    if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(category)) throw new BadRequestException('Invalid notification category.');
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Buffer.byteLength(JSON.stringify(payload)) > 8000) {
      throw new BadRequestException('Notification payload must be an object up to 8 KB.');
    }
    if (dedupeKey !== undefined && (typeof dedupeKey !== 'string' || !dedupeKey.trim() || dedupeKey.length > 180)) {
      throw new BadRequestException('Invalid notification deduplication key.');
    }
    return this.db.transaction(async client => {
      const inserted = await client.query(
        `INSERT INTO notifications(user_id,category,payload,dedupe_key)
         VALUES($1,$2,$3::jsonb,$4)
         ON CONFLICT(user_id,dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING id,category,payload,read_at,created_at`,
        [userId,category,JSON.stringify(payload),dedupeKey ?? null],
      );
      let notification = inserted.rows[0];
      if (!notification && dedupeKey) {
        const existing = await client.query(
          `SELECT id,category,payload,read_at,created_at FROM notifications
           WHERE user_id=$1 AND dedupe_key=$2`,[userId,dedupeKey],
        );
        notification = existing.rows[0];
      }
      if (!notification) throw new NotFoundException('Notification could not be created.');
      const preferences = await client.query(
        `SELECT push_enabled FROM notification_preferences
         WHERE user_id=$1 AND category=$2`,[userId,category],
      );
      const pushEnabled = preferences.rowCount ? preferences.rows[0].push_enabled : true;
      if (pushEnabled) {
        await client.query(
          `INSERT INTO notification_outbox(notification_id,user_id,device_id,channel)
           SELECT $1,$2,d.id,'push' FROM devices d
           WHERE d.user_id=$2 AND d.revoked_at IS NULL
           ON CONFLICT(notification_id,device_id,channel) DO NOTHING`,
          [notification.id,userId],
        );
      }
      return notification;
    });
  }

  async listPreferences(userId: string) {
    const result = await this.db.query(
      `SELECT category,in_app_enabled,push_enabled,updated_at
       FROM notification_preferences WHERE user_id=$1 ORDER BY category`,[userId],
    );
    return result.rows;
  }

  async setPreference(userId: string, category: string, input: unknown) {
    if (!/^[a-z][a-z0-9_.-]{1,79}$/.test(category)) throw new BadRequestException('Invalid notification category.');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Preference data is required.');
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['inAppEnabled','pushEnabled'].includes(key)) ||
        (value.inAppEnabled !== undefined && typeof value.inAppEnabled !== 'boolean') ||
        (value.pushEnabled !== undefined && typeof value.pushEnabled !== 'boolean') ||
        (value.inAppEnabled === undefined && value.pushEnabled === undefined)) {
      throw new BadRequestException('Provide inAppEnabled and/or pushEnabled as booleans.');
    }
    const result = await this.db.query(
      `INSERT INTO notification_preferences(user_id,category,in_app_enabled,push_enabled)
       VALUES($1,$2,COALESCE($3,true),COALESCE($4,true))
       ON CONFLICT(user_id,category) DO UPDATE SET
         in_app_enabled=COALESCE($3,notification_preferences.in_app_enabled),
         push_enabled=COALESCE($4,notification_preferences.push_enabled),
         updated_at=now()
       RETURNING category,in_app_enabled,push_enabled,updated_at`,
      [userId,category,value.inAppEnabled ?? null,value.pushEnabled ?? null],
    );
    return result.rows[0];
  }

  async claimPushDeliveries(limit = 50) {
    const batchSize = Math.min(Math.max(Number(limit) || 50, 1), 100);
    return this.db.transaction(async client => {
      const claimed = await client.query(
        `WITH candidates AS (
           SELECT o.id FROM notification_outbox o
           JOIN devices d ON d.id=o.device_id AND d.revoked_at IS NULL
           WHERE o.channel='push' AND o.status IN ('pending','failed')
             AND o.next_attempt_at<=now() AND o.attempts<8
             AND d.push_token_encrypted IS NOT NULL
           ORDER BY o.next_attempt_at,o.created_at
           LIMIT $1 FOR UPDATE OF o SKIP LOCKED
         )
         UPDATE notification_outbox o SET status='processing',attempts=o.attempts+1
         FROM candidates c WHERE o.id=c.id
         RETURNING o.id,o.notification_id,o.user_id,o.device_id,o.attempts`,
        [batchSize],
      );
      if (!claimed.rowCount) return [];
      const ids = claimed.rows.map(row => row.id);
      const details = await client.query(
        `SELECT o.id,o.notification_id,o.user_id,o.device_id,o.attempts,
                d.platform,d.push_token_encrypted,n.category,n.payload
         FROM notification_outbox o
         JOIN devices d ON d.id=o.device_id
         JOIN notifications n ON n.id=o.notification_id
         WHERE o.id=ANY($1::uuid[])
         ORDER BY o.created_at,o.id`,[ids],
      );
      return details.rows;
    });
  }

  async completePushDelivery(
    outboxId: string,
    result: { delivered: true; providerMessageId?: string } | { delivered: false; errorCode: string },
  ) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(outboxId)) {
      throw new BadRequestException('outboxId must be a UUID.');
    }
    if (result.delivered) {
      const updated = await this.db.query(
        `UPDATE notification_outbox SET status='delivered',provider_message_id=$2,
           delivered_at=now(),last_error_code=NULL
         WHERE id=$1 AND status='processing' RETURNING id,status,delivered_at`,
        [outboxId,result.providerMessageId?.slice(0,255) ?? null],
      );
      if (!updated.rowCount) throw new NotFoundException('Processing delivery not found.');
      return updated.rows[0];
    }
    if (!result.errorCode || result.errorCode.length > 120) throw new BadRequestException('A valid delivery error code is required.');
    const updated = await this.db.query(
      `UPDATE notification_outbox SET
         status=CASE WHEN attempts>=8 THEN 'cancelled' ELSE 'failed' END,
         last_error_code=$2,
         next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*(2^LEAST(attempts,7))::integer))
       WHERE id=$1 AND status='processing'
       RETURNING id,status,attempts,next_attempt_at`,
      [outboxId,result.errorCode],
    );
    if (!updated.rowCount) throw new NotFoundException('Processing delivery not found.');
    return updated.rows[0];
  }
}
