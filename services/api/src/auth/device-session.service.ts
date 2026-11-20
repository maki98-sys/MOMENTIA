import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

const PLATFORMS = ['ios', 'android', 'web'] as const;
type DevicePlatform = typeof PLATFORMS[number];

@Injectable()
export class DeviceSessionService {
  constructor(private readonly db: DatabaseService) {}

  async registerDevice(userId: string, input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Device data is required.');
    }
    const value = input as Record<string, unknown>;
    if (Object.keys(value).some(key => !['platform', 'pushTokenEncrypted'].includes(key))) {
      throw new BadRequestException('Unsupported device fields.');
    }
    if (!PLATFORMS.includes(value.platform as DevicePlatform)) {
      throw new BadRequestException('Platform must be ios, android or web.');
    }
    const pushToken = value.pushTokenEncrypted ?? null;
    if (pushToken !== null && (typeof pushToken !== 'string' || pushToken.length > 4096)) {
      throw new BadRequestException('Invalid encrypted push token.');
    }
    const result = await this.db.query(
      `INSERT INTO devices(user_id, platform, push_token_encrypted, last_seen_at)
       VALUES($1,$2,$3,now())
       RETURNING id, platform, last_seen_at, created_at`,
      [userId, value.platform, pushToken],
    );
    return result.rows[0];
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
    return this.db.transaction(async client => {
      const result = await client.query(
        `UPDATE devices SET revoked_at=now()
         WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
         RETURNING id`,
        [deviceId,userId],
      );
      if (!result.rowCount) throw new NotFoundException('Active device not found.');
      await client.query(
        `UPDATE auth_sessions SET revoked_at=now()
         WHERE device_id=$1 AND user_id=$2 AND revoked_at IS NULL`,
        [deviceId,userId],
      );
      return { revoked: true };
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
    const result = await this.db.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId,userId],
    );
    if (!result.rowCount) throw new NotFoundException('Active session not found.');
    return { revoked: true };
  }

  async revokeAllSessions(userId: string) {
    const result = await this.db.query(
      `UPDATE auth_sessions SET revoked_at=now()
       WHERE user_id=$1 AND revoked_at IS NULL
       RETURNING id`,
      [userId],
    );
    return { revokedCount: result.rowCount ?? 0 };
  }
}
