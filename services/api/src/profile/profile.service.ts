import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export type ProfileVisibility = 'public' | 'followers' | 'private';

export interface MyAccount {
  id: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
  profile: {
    displayName: string;
    bio: string | null;
    visibility: ProfileVisibility;
  } | null;
}

export interface UpdateProfileInput {
  displayName: string;
  bio: string | null;
  visibility: ProfileVisibility;
}

@Injectable()
export class ProfileService {
  constructor(private readonly database: DatabaseService) {}

  async getMe(userId: string): Promise<MyAccount> {
    const result = await this.database.query(
      `SELECT u.id, u.email_normalized, u.phone_e164, u.status, u.created_at,
              p.display_name, p.bio, p.visibility
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1 AND u.status = 'active'
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('MOMENTIA account was not found or is not active.');

    const hasProfile = typeof row.display_name === 'string';
    return {
      id: String(row.id),
      email: row.email_normalized == null ? null : String(row.email_normalized),
      phone: row.phone_e164 == null ? null : String(row.phone_e164),
      status: String(row.status),
      createdAt: new Date(String(row.created_at)).toISOString(),
      profile: hasProfile ? {
        displayName: String(row.display_name),
        bio: row.bio == null ? null : String(row.bio),
        visibility: row.visibility as ProfileVisibility,
      } : null,
    };
  }

  async getPublicProfile(viewerId: string, targetId: string) {
    const result = await this.database.query(
      `SELECT u.id, p.display_name, p.bio, p.visibility, p.avatar_media_id,
              CASE WHEN ur.state = 'accepted' THEN true ELSE false END AS viewer_follows
       FROM users u
       JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN user_relationships ur
         ON ur.requester_id = $1 AND ur.target_id = u.id AND ur.state = 'accepted'
       WHERE u.id = $2 AND u.status = 'active'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
              OR (b.blocker_id = u.id AND b.blocked_id = $1)
         )
       LIMIT 1`,
      [viewerId, targetId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('Profile not found.');
    const visibility = String(row.visibility);
    const isOwner = viewerId === targetId;
    const canView = isOwner || visibility === 'public'
      || (visibility === 'followers' && row.viewer_follows === true);
    if (!canView) throw new NotFoundException('Profile not found.');
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      bio: row.bio == null ? null : String(row.bio),
      avatarMediaId: row.avatar_media_id == null ? null : String(row.avatar_media_id),
    };
  }

  async updateMyProfile(userId: string, input: UpdateProfileInput): Promise<MyAccount['profile']> {
    const result = await this.database.query(
      `INSERT INTO user_profiles (user_id, display_name, bio, visibility)
       SELECT id, $2, $3, $4 FROM users WHERE id = $1 AND status = 'active'
       ON CONFLICT (user_id) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             bio = EXCLUDED.bio,
             visibility = EXCLUDED.visibility,
             updated_at = now()
       RETURNING display_name, bio, visibility`,
      [userId, input.displayName, input.bio, input.visibility],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('MOMENTIA account was not found or is not active.');
    return {
      displayName: String(row.display_name),
      bio: row.bio == null ? null : String(row.bio),
      visibility: row.visibility as ProfileVisibility,
    };
  }

  validateProfileInput(value: unknown): UpdateProfileInput {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('A profile object is required.');
    }
    const body = value as Record<string, unknown>;
    const allowed = ['displayName', 'bio', 'visibility'];
    if (Object.keys(body).some((key) => !allowed.includes(key))) {
      throw new BadRequestException('The profile contains unsupported fields.');
    }
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
    if (!displayName || displayName.length > 80) {
      throw new BadRequestException('displayName must contain between 1 and 80 characters.');
    }
    const bio = body.bio == null ? null : typeof body.bio === 'string' ? body.bio.trim() : undefined;
    if (bio === undefined || (bio !== null && bio.length > 500)) {
      throw new BadRequestException('bio must be a string of at most 500 characters or null.');
    }
    const visibility = body.visibility;
    if (visibility !== 'public' && visibility !== 'followers' && visibility !== 'private') {
      throw new BadRequestException('visibility must be public, followers or private.');
    }
    return { displayName, bio, visibility };
  }
}
