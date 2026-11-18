import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { OidcPrincipal } from './auth.types';

export interface ResolvedIdentity {
  userId: string;
  created: boolean;
}

@Injectable()
export class OidcIdentityService {
  constructor(private readonly database: DatabaseService) {}

  async resolveOrProvision(principal: OidcPrincipal): Promise<ResolvedIdentity> {
    return this.database.transaction(async (client) => {
      // Serialize first-login attempts for the same external identity.
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${principal.issuer}:${principal.subject}`],
      );

      const existing = await this.findIdentity(client, principal.issuer, principal.subject);
      if (existing) {
        if (existing.status !== 'active') {
          throw new ForbiddenException('This MOMENTIA account is not active.');
        }
        return { userId: existing.id, created: false };
      }

      // Never create/link an account using an unverified email address.
      if (!principal.email || principal.emailVerified !== true) {
        throw new UnauthorizedException('A verified email address is required to create a MOMENTIA account.');
      }

      const email = principal.email.trim().toLowerCase();
      if (!email || email.length > 320) {
        throw new UnauthorizedException('The identity provider returned an invalid email address.');
      }

      // Existing accounts must use an authenticated account-linking flow.
      // Matching email alone is deliberately not sufficient to link identities.
      const emailOwner = await client.query<Record<string, unknown>>(
        'SELECT id FROM users WHERE email_normalized = $1 LIMIT 1',
        [email],
      );
      if (emailOwner.rowCount) {
        throw new ConflictException('An account already uses this email. Sign in to that account before linking another identity provider.');
      }

      const userResult = await client.query<Record<string, unknown>>(
        `INSERT INTO users (email_normalized, email_verified_at, status)
         VALUES ($1, now(), 'active')
         RETURNING id`,
        [email],
      );
      const userId = String(userResult.rows[0]?.id ?? '');
      if (!userId) throw new Error('User provisioning did not return an account ID.');

      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject)
         VALUES ($1, $2, $3)`,
        [userId, principal.issuer, principal.subject],
      );

      return { userId, created: true };
    });
  }

  private async findIdentity(
    client: PoolClient,
    issuer: string,
    subject: string,
  ): Promise<{ id: string; status: string } | null> {
    const result = await client.query<Record<string, unknown>>(
      `SELECT u.id, u.status
       FROM auth_identities ai
       JOIN users u ON u.id = ai.user_id
       WHERE ai.provider = $1 AND ai.provider_subject = $2
       LIMIT 1
       FOR UPDATE OF u`,
      [issuer, subject],
    );
    const row = result.rows[0];
    return row
      ? { id: String(row.id), status: String(row.status) }
      : null;
  }
}
