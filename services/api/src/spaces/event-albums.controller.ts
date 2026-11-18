import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { EventAlbumsService } from './event-albums.service';

@Controller()
@UseGuards(OidcBearerGuard)
export class EventAlbumsController {
  constructor(private readonly albums: EventAlbumsService) {}

  @Post('spaces/:spaceId/albums')
  async create(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
  ) {
    assertUuid(spaceId, 'spaceId');
    const input = requireObject(body);
    rejectUnexpected(input, ['title', 'sortMode']);
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 120) {
      throw new BadRequestException('title must contain between 1 and 120 characters.');
    }
    const sortMode = input.sortMode ?? 'captured_at';
    if (sortMode !== 'captured_at' && sortMode !== 'uploaded_at' && sortMode !== 'added_at') {
      throw new BadRequestException('sortMode must be captured_at, uploaded_at or added_at.');
    }
    return { album: await this.albums.create(requireUserId(request), spaceId, input.title.trim(), sortMode) };
  }

  @Get('spaces/:spaceId/albums')
  async list(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    assertUuid(spaceId, 'spaceId');
    return { albums: await this.albums.list(requireUserId(request), spaceId) };
  }

  @Get('albums/:albumId')
  async listItems(
    @Req() request: Request & AuthenticatedRequest,
    @Param('albumId') albumId: string,
  ) {
    assertUuid(albumId, 'albumId');
    return { items: await this.albums.listItems(requireUserId(request), albumId) };
  }

  @Post('albums/:albumId/items')
  async addMedia(
    @Req() request: Request & AuthenticatedRequest,
    @Param('albumId') albumId: string,
    @Body() body: unknown,
  ) {
    assertUuid(albumId, 'albumId');
    const input = requireObject(body);
    rejectUnexpected(input, ['mediaAssetId']);
    if (typeof input.mediaAssetId !== 'string' || !isUuid(input.mediaAssetId)) {
      throw new BadRequestException('mediaAssetId must be a valid UUID.');
    }
    return { item: await this.albums.addMedia(requireUserId(request), albumId, input.mediaAssetId) };
  }

  @Delete('albums/:albumId/items/:mediaAssetId')
  async removeMedia(
    @Req() request: Request & AuthenticatedRequest,
    @Param('albumId') albumId: string,
    @Param('mediaAssetId') mediaAssetId: string,
  ) {
    assertUuid(albumId, 'albumId');
    assertUuid(mediaAssetId, 'mediaAssetId');
    await this.albums.removeMedia(requireUserId(request), albumId, mediaAssetId);
    return { success: true };
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
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
