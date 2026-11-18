export type ProfileVisibility = 'public' | 'followers' | 'private';

export interface UserProfile {
  userId: string;
  displayName: string;
  bio: string | null;
  visibility: ProfileVisibility;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  displayName: string;
  bio: string | null;
  visibility: ProfileVisibility;
}
