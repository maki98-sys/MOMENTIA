import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { PostsService } from './posts.service';
import type { CreatePostInput, FeedCursor, PostAudience } from './post.types';

@Controller()
@UseGuards(OidcBearerGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post('posts')
  async create(@Req() request: Request & AuthenticatedRequest, @Body() body: unknown) {
    return { post: await this.posts.create(requireUserId(request), parseCreatePost(body)) };
  }

  @Get('feed')
  async feed(@Req() request: Request & AuthenticatedRequest, @Query('cursor') cursor?: string) {
    return this.posts.feed(requireUserId(request), cursor ? parseCursor(cursor) : null);
  }

  @Get('posts/:postId')
  async get(
    @Req() request: Request & AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    assertUuid(postId, 'postId');
    return { post: await this.posts.get(requireUserId(request), postId) };
  }

  @Post('posts/:postId/comments')
  async addComment(
    @Req() request: Request & AuthenticatedRequest,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ) {
    assertUuid(postId, 'postId');
    const input = requireObject(body);
    rejectUnexpected(input, ['body']);
    if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > 3000) {
      throw new BadRequestException('body must contain between 1 and 3000 characters.');
    }
    return { comment: await this.posts.addComment(requireUserId(request), postId, input.body.trim()) };
  }

  @Get('posts/:postId/comments')
  async listComments(
    @Req() request: Request & AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    assertUuid(postId, 'postId');
    return { comments: await this.posts.listComments(requireUserId(request), postId) };
  }

  @Put('posts/:postId/reaction')
  async setReaction(
    @Req() request: Request & AuthenticatedRequest,
    @Param('postId') postId: string,
    @Body() body: unknown,
  ) {
    assertUuid(postId, 'postId');
    const input = requireObject(body);
    rejectUnexpected(input, ['reaction']);
    const reaction = input.reaction;
    if (reaction !== 'like' && reaction !== 'love' && reaction !== 'laugh' &&
        reaction !== 'wow' && reaction !== 'support') {
      throw new BadRequestException('reaction must be like, love, laugh, wow or support.');
    }
    return { reaction: await this.posts.setReaction(requireUserId(request), postId, reaction) };
  }

  @Delete('posts/:postId/reaction')
  async removeReaction(
    @Req() request: Request & AuthenticatedRequest,
    @Param('postId') postId: string,
  ) {
    assertUuid(postId, 'postId');
    await this.posts.removeReaction(requireUserId(request), postId);
    return { success: true };
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
}

function parseCreatePost(value: unknown): CreatePostInput {
  const body = requireObject(value);
  rejectUnexpected(body, ['body', 'mediaAssetId', 'audience', 'spaceId']);
  const text = body.body;
  if (text !== undefined && text !== null &&
      (typeof text !== 'string' || text.length > 5000)) {
    throw new BadRequestException('body must be at most 5000 characters or null.');
  }
  const mediaAssetId = body.mediaAssetId ?? null;
  if (mediaAssetId !== null && (typeof mediaAssetId !== 'string' || !isUuid(mediaAssetId))) {
    throw new BadRequestException('mediaAssetId must be a valid UUID or null.');
  }
  const audience = body.audience ?? 'private';
  if (audience !== 'public' && audience !== 'followers' && audience !== 'space' && audience !== 'private') {
    throw new BadRequestException('audience must be public, followers, space or private.');
  }
  const spaceId = body.spaceId ?? null;
  if (spaceId !== null && (typeof spaceId !== 'string' || !isUuid(spaceId))) {
    throw new BadRequestException('spaceId must be a valid UUID or null.');
  }
  if (audience === 'space' && !spaceId) {
    throw new BadRequestException('spaceId is required for space audience.');
  }
  if (audience !== 'space' && spaceId) {
    throw new BadRequestException('spaceId is only allowed for space audience.');
  }
  const normalizedBody = typeof text === 'string' ? text.trim() || null : null;
  if (!normalizedBody && !mediaAssetId) {
    throw new BadRequestException('A post must contain text or mediaAssetId.');
  }
  return {
    body: normalizedBody,
    mediaAssetId: mediaAssetId as string | null,
    audience: audience as PostAudience,
    spaceId: spaceId as string | null,
  };
}

function parseCursor(value: string): FeedCursor {
  if (value.length > 512) throw new BadRequestException('Invalid feed cursor.');
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof parsed.publishedAt !== 'string' || Number.isNaN(Date.parse(parsed.publishedAt)) ||
        typeof parsed.id !== 'string' || !isUuid(parsed.id)) {
      throw new Error('Invalid cursor fields.');
    }
    return { publishedAt: parsed.publishedAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Invalid feed cursor.');
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function rejectUnexpected(body: Record<string, unknown>, allowed: string[]): void {
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new BadRequestException(`Unexpected fields: ${unexpected.join(', ')}.`);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) throw new BadRequestException(`${field} must be a valid UUID.`);
}
