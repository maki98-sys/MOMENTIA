import { Injectable, UnauthorizedException, ConfigService } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { DatabaseService } from '../database/database.service';

const ACCESS_TTL_SECONDS = 15 * 60;
const SESSION_TTL_DAYS = 30;
const TOKEN_ISSUER = 'momentia-api';
const TOKEN_AUDIENCE = 'momentia-mobile';

@Injectable()
export class SessionTokenService {
  private readonly secret: Uint8Array;
  constructor(private readonly db: DatabaseService, config: ConfigService) {
    const value = config.get<string>('MOMENTIA_SESSION_SECRET') ?? '';
    this.secret = new TextEncoder().encode(value);
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private newRefreshToken(): string {
    return `mrt_${randomBytes(48).toString('base64url')}`;
  }

  private async accessToken(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId, typ: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  async create(userId: string, deviceId?: string, metadata?: { userAgent?: string; ipAddress?: string }) {
    const refreshToken = this.newRefreshToken();
    const refreshHash = this.hash(refreshToken);
    const familyId = randomBytes(16).toString('hex');
    const session = await this.db.transaction(async client => {
      if (deviceId) {
        const device = await client.query(
          `SELECT id FROM devices WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL FOR UPDATE`,
          [deviceId,userId],
        );
        if (!device.rowCount) throw new UnauthorizedException('Active device not found.');
      }
      const inserted = await client.query(
        `INSERT INTO auth_sessions(user_id,device_id,refresh_token_hash,family_id,expires_at,user_agent,ip_address)
         VALUES($1,$2,$3,$4,now()+($5::int * interval '1 day'),$6,$7)
         RETURNING id,expires_at`,
        [userId,deviceId ?? null,refreshHash,familyId,SESSION_TTL_DAYS,
          metadata?.userAgent?.slice(0,500) ?? null,metadata?.ipAddress ?? null],
      );
      await client.query(
        `INSERT INTO auth_session_refresh_tokens(token_hash,session_id,family_id,expires_at)
         VALUES($1,$2,$3,$4)`,
        [refreshHash,inserted.rows[0].id,familyId,inserted.rows[0].expires_at],
      );
      return inserted.rows[0];
    });
    return {
      accessToken: await this.accessToken(userId,String(session.id)),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL_SECONDS,
      refreshExpiresAt: session.expires_at,
      sessionId: session.id,
    };
  }

  async refresh(refreshToken: string) {
    if (typeof refreshToken !== 'string' || !/^mrt_[A-Za-z0-9_-]{60,80}$/.test(refreshToken)) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }
    const oldHash = this.hash(refreshToken);
    const nextRefreshToken = this.newRefreshToken();
    const nextHash = this.hash(nextRefreshToken);
    const result = await this.db.transaction(async client => {
      const token = await client.query(
        `SELECT token_hash,session_id,family_id,expires_at,consumed_at
         FROM auth_session_refresh_tokens WHERE token_hash=$1 FOR UPDATE`,[oldHash],
      );
      if (!token.rowCount) throw new UnauthorizedException('Refresh token is invalid.');
      const row = token.rows[0];
      if (row.consumed_at) {
        await client.query(
          `UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now())
           WHERE family_id=$1 AND revoked_at IS NULL`,[row.family_id],
        );
        throw new UnauthorizedException('Refresh token reuse detected. The session family was revoked.');
      }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException('Refresh token has expired.');
      }
      const session = await client.query(
        `SELECT s.id,s.user_id,s.device_id,s.expires_at,u.status,
                d.revoked_at device_revoked_at
         FROM auth_sessions s JOIN users u ON u.id=s.user_id
         LEFT JOIN devices d ON d.id=s.device_id
         WHERE s.id=$1 AND s.family_id=$2 FOR UPDATE OF s,u`,
        [row.session_id,row.family_id],
      );
      if (!session.rowCount || session.rows[0].status!=='active' ||
          session.rows[0].device_revoked_at || session.rows[0].expires_at <= new Date()) {
        throw new UnauthorizedException('Session is no longer active.');
      }
      const consumed = await client.query(
        `UPDATE auth_session_refresh_tokens SET consumed_at=now(),replaced_by_hash=$2
         WHERE token_hash=$1 AND consumed_at IS NULL RETURNING token_hash`,[oldHash,nextHash],
      );
      if (!consumed.rowCount) throw new UnauthorizedException('Refresh token was already used.');
      await client.query(
        `INSERT INTO auth_session_refresh_tokens(token_hash,session_id,family_id,expires_at)
         VALUES($1,$2,$3,$4)`,
        [nextHash,row.session_id,row.family_id,session.rows[0].expires_at],
      );
      await client.query(
        `UPDATE auth_sessions SET refresh_token_hash=$1,last_used_at=now()
         WHERE id=$2`,[nextHash,row.session_id],
      );
      return { userId:String(session.rows[0].user_id),sessionId:String(row.session_id),expiresAt:session.rows[0].expires_at };
    });
    return {
      accessToken: await this.accessToken(result.userId,result.sessionId),
      refreshToken: nextRefreshToken,
      tokenType: 'Bearer',
      expiresIn: ACCESS_TTL_SECONDS,
      refreshExpiresAt: result.expiresAt,
      sessionId: result.sessionId,
    };
  }

  async verifyAccessToken(token: string): Promise<string> {
    if (!token.startsWith('mta_')) throw new UnauthorizedException('Invalid MOMENTIA access token.');
    try {
      const { payload } = await jwtVerify(token.slice(4),this.secret,{
        issuer:TOKEN_ISSUER,audience:TOKEN_AUDIENCE,algorithms:['HS256'],
        requiredClaims:['sub','sid','exp'],
        clockTolerance:5,
      });
      if (typeof payload.sub!=='string'||typeof payload.sid!=='string'||payload.typ!=='access') {
        throw new UnauthorizedException('Invalid MOMENTIA access token.');
      }
      const active=await this.db.query(
        `SELECT s.user_id FROM auth_sessions s JOIN users u ON u.id=s.user_id
         LEFT JOIN devices d ON d.id=s.device_id
         WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL
           AND s.expires_at>now() AND u.status='active'
           AND (s.device_id IS NULL OR (d.id IS NOT NULL AND d.revoked_at IS NULL))`,
        [payload.sid,payload.sub],
      );
      if (!active.rowCount) throw new UnauthorizedException('MOMENTIA session is revoked or expired.');
      return String(active.rows[0].user_id);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('MOMENTIA access token is invalid or expired.');
    }
  }
}
