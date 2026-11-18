export type PostAudience = 'public' | 'followers' | 'space' | 'private';
export type ReactionType = 'like' | 'love' | 'laugh' | 'wow' | 'support';

export interface CreatePostInput {
  body: string | null;
  mediaAssetId: string | null;
  audience: PostAudience;
  spaceId: string | null;
}

export interface FeedCursor {
  publishedAt: string;
  id: string;
}
