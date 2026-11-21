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

      const localPart=email.split('@')[0].replace(/[._+-]+/g,' ').trim();
      const displayName=(localPart||'Nuevo usuario').slice(0,80);
      await client.query(
        `INSERT INTO user_profiles(user_id,display_name,visibility)
         VALUES($1,$2,'private') ON CONFLICT(user_id) DO NOTHING`,
        [userId,displayName],
      );

      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject)
         VALUES ($1, $2, $3)`,
        [userId, principal.issuer, principal.subject],
      );

      return { userId, created: true };
    });
  }


  async linkAuthenticatedIdentity(userId: string, principal: OidcPrincipal): Promise<{ linked: true }> {
    if (!principal.issuer || !principal.subject || principal.subject.length > 512) {
      throw new UnauthorizedException('The external identity proof is invalid.');
    }
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`identity-link:${principal.issuer}:${principal.subject}`],
      );
      const owner = await client.query(
        `SELECT user_id FROM auth_identities
         WHERE provider=$1 AND provider_subject=$2
         LIMIT 1 FOR UPDATE`,
        [principal.issuer, principal.subject],
      );
      if (owner.rowCount) {
        if (String(owner.rows[0].user_id) === userId) return { linked: true };
        throw new ConflictException('This external identity is already linked to another MOMENTIA account.');
      }
      const account = await client.query(
        `SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE`,
        [userId],
      );
      if (!account.rowCount) throw new ForbiddenException('The MOMENTIA account is not active.');
      const inserted = await client.query(
        `INSERT INTO auth_identities(user_id,provider,provider_subject)
         VALUES($1,$2,$3) RETURNING id`,
        [userId, principal.issuer, principal.subject],
      );
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'AUTH_IDENTITY_LINKED','auth_identity',$2,$3::jsonb)`,
        [userId,inserted.rows[0].id,JSON.stringify({ provider: principal.issuer })],
      );
      return { linked: true };
    });
  }



  async listAuthenticatedIdentities(userId: string) {
    const result = await this.database.query(
      `SELECT provider,created_at
       FROM auth_identities
       WHERE user_id=$1
       ORDER BY created_at,provider`,
      [userId],
    );
    return {
      identities: result.rows.map((row: Record<string, unknown>) => ({
        provider: String(row.provider),
        linkedAt: row.created_at,
      })),
      canUnlink: result.rowCount > 1,
    };
  }

  async unlinkAuthenticatedIdentity(userId: string, principal: OidcPrincipal): Promise<{ unlinked: true }> {
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`identity-link:${principal.issuer}:${principal.subject}`],
      );
      const account = await client.query(
        `SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE`,
        [userId],
      );
      if (!account.rowCount) throw new ForbiddenException('The MOMENTIA account is not active.');
      const identities = await client.query(
        `SELECT id,provider,provider_subject FROM auth_identities
         WHERE user_id=$1 ORDER BY created_at,id FOR UPDATE`,
        [userId],
      );
      const target = identities.rows.find((row: Record<string, unknown>) =>
        row.provider === principal.issuer && row.provider_subject === principal.subject);
      if (!target) throw new ConflictException('This external identity is not linked to the current account.');
      if (identities.rowCount <= 1) {
        throw new ConflictException('The last sign-in identity cannot be removed. Link another identity first.');
      }
      await client.query(
        'DELETE FROM auth_identities WHERE id=$1 AND user_id=$2',
        [target.id,userId],
      );
      await client.query(
        `INSERT INTO user_audit_events(actor_id,subject_user_id,action,target_type,target_id,metadata)
         VALUES($1,$1,'AUTH_IDENTITY_UNLINKED','auth_identity',$2,$3::jsonb)`,
        [userId,target.id,JSON.stringify({ provider: principal.issuer })],
      );
      return { unlinked: true };
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
