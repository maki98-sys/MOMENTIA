import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { encryptPushToken } from '../notifications/push-token-crypto';

const PLATFORMS = ['ios', 'android', 'web'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertUuid(value: string, field: string) {
  if (!UUID_RE.test(value)) throw new BadRequestException(`${field} must be a UUID.`);
}
type DevicePlatform = typeof PLATFORMS[number];

@Injectable()
export class DeviceSessionService {
  constructor(private readonly db: DatabaseService) {}

  async registerDevice(userId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Device data is required.');
    }
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['platform', 'pushToken'].includes(key))) {
      throw new BadRequestException('Unsupported device fields.');
    }
    if (!PLATFORMS.includes(value.platform as DevicePlatform)) {
      throw new BadRequestException('Platform must be ios, android or web.');
    }
    const pushToken = value.pushToken ?? null;
    if (pushToken !== null && (typeof pushToken !== 'string' || pushToken.length > 4096 || !pushToken.trim())) {
      throw new BadRequestException('Invalid push token.');
    }
    let encryptedPushToken: string | null = null;
    if (pushToken !== null) {
      try { encryptedPushToken = encryptPushToken(pushToken); }
      catch { throw new BadRequestException('Push token encryption is not configured.'); }
    }
    return this.db.transaction(async client => {
      const result = await client.query(
        `INSERT INTO devices(user_id, platform, push_token_encrypted, last_seen_at)
         VALUES($1,$2,$3,now())
         RETURNING id, platform, last_seen_at, created_at`,
        [userId, value.platform, encryptedPushToken],
      );
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'auth.device.registered','device',$2,jsonb_build_object('platform',$3))`,
        [userId,result.rows[0].id,value.platform],
      );
      return result.rows[0];
    });
  }

  async listDevices(userId: string) {
    const result = await this.db.query(
      `SELECT id,platform,last_seen_at,created_at
       FROM devices WHERE user_id=$1 AND revoked_at IS NULL
       ORDER BY last_seen_at DESC NULLS LAST, created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async heartbeat(userId: string, deviceId: string) {
    assertUuid(deviceId, 'deviceId');
    const result = await this.db.query(
      `UPDATE devices SET last_seen_at=now()
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
       RETURNING id,last_seen_at`,
      [deviceId,userId],
    );
    if (!result.rowCount) throw new NotFoundException('Active device not found.');
    return result.rows[0];
  }

  async revokeDevice(userId: string, deviceId: string) {
    assertUuid(deviceId, 'deviceId');
    return this.db.transaction(async client => {
      const result = await client.query(
        `UPDATE devices SET revoked_at=now()
         WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
         RETURNING id`,
        [deviceId,userId],
      );
      if (!result.rowCount) throw new NotFoundException('Active device not found.');
      const sessions = await client.query(
        `UPDATE auth_sessions SET revoked_at=now()
         WHERE device_id=$1 AND user_id=$2 AND revoked_at IS NULL
         RETURNING id`,
        [deviceId,userId],
      );
      const pendingPush = await client.query(
        `UPDATE notification_outbox
         SET status='cancelled',processing_started_at=NULL,last_error_code='DEVICE_REVOKED'
         WHERE device_id=$1 AND user_id=$2 AND channel='push'
           AND status IN ('pending','failed','processing')
         RETURNING id`,
        [deviceId,userId],
      );
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'auth.device.revoked','device',$2,jsonb_build_object('revokedSessions',$3))`,
        [userId,deviceId,sessions.rowCount ?? 0],
      );
      return { revoked: true, revokedSessions: sessions.rowCount ?? 0, cancelledPushDeliveries: pendingPush.rowCount ?? 0 };
    });
  }

  async listSessions(userId: string) {
    const result = await this.db.query(
      `SELECT s.id,s.device_id,s.created_at,s.expires_at,
              CASE WHEN s.revoked_at IS NULL AND s.expires_at>now() THEN 'active'
                   WHEN s.revoked_at IS NOT NULL THEN 'revoked'
                   ELSE 'expired' END AS status,
              d.platform
       FROM auth_sessions s
       LEFT JOIN devices d ON d.id=s.device_id AND d.user_id=s.user_id
       WHERE s.user_id=$1
       ORDER BY s.created_at DESC LIMIT 100`,
      [userId],
    );
    return result.rows;
  }

  async revokeSession(userId: string, sessionId: string) {
    assertUuid(sessionId, 'sessionId');
    return this.db.transaction(async client => {
      const result = await client.query(
        `UPDATE auth_sessions SET revoked_at=now()
         WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
         RETURNING id`,
        [sessionId,userId],
      );
      if (!result.rowCount) throw new NotFoundException('Active session not found.');
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id)
         VALUES($1,$1,'auth.session.revoked','session',$2)`,
        [userId,sessionId],
      );
      return { revoked: true };
    });
  }

  async revokeAllSessions(userId: string) {
    return this.db.transaction(async client => {
      const result = await client.query(
        `UPDATE auth_sessions SET revoked_at=now()
         WHERE user_id=$1 AND revoked_at IS NULL
         RETURNING id`,
        [userId],
      );
      for (const session of result.rows) {
        await client.query(
          `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id)
           VALUES($1,$1,'auth.session.revoked','session',$2)`,
          [userId,session.id],
        );
      }
      return { revokedCount: result.rowCount ?? 0 };
    });
  }
}
