import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { UpdateProfileInput, UserProfile } from './profile.types';

interface ProfileRow extends Record<string, unknown> {
  user_id: string;
  display_name: string;
  bio: string | null;
  visibility: 'public' | 'followers' | 'private';
  created_at: Date | string;
  updated_at: Date | string;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly database: DatabaseService) {}

  async findMine(userId: string): Promise<UserProfile | null> {
    const result = await this.database.query<ProfileRow>(
      `SELECT user_id, display_name, bio, visibility, created_at, updated_at
       FROM user_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? toProfile(row) : null;
  }

  async updateMine(userId: string, input: UpdateProfileInput): Promise<UserProfile> {
    const result = await this.database.query<ProfileRow>(
      `INSERT INTO user_profiles (user_id, display_name, bio, visibility)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         bio = EXCLUDED.bio,
         visibility = EXCLUDED.visibility,
         updated_at = now()
       RETURNING user_id, display_name, bio, visibility, created_at, updated_at`,
      [userId, input.displayName, input.bio, input.visibility],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Profile upsert did not return a row.');
    return toProfile(row);
  }
}

function toProfile(row: ProfileRow): UserProfile {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio,
    visibility: row.visibility,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
