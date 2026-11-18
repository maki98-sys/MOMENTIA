export type SpaceType = 'EVENT' | 'COUPLE' | 'CIRCLE';
export type SpaceVisibility = 'public' | 'unlisted' | 'private';
export type SpaceRole = 'owner' | 'admin' | 'moderator' | 'member' | 'guest';

export interface CreateSpaceInput {
  type: SpaceType;
  name: string;
  visibility: SpaceVisibility;
  partnerUserId?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone?: string;
  description?: string | null;
  joinPolicy?: 'invite' | 'approval';
}

export interface CreateInvitationInput {
  role: 'admin' | 'moderator' | 'member' | 'guest';
  expiresInHours: number;
  maxUses: number;
}

export interface SpaceSummary {
  id: string;
  type: SpaceType;
  name: string;
  visibility: SpaceVisibility;
  status: 'active' | 'archived' | 'closed';
  role: SpaceRole;
  createdAt: string;
}
