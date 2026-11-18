import {
  BadRequestException, Body, Controller, Headers, Param, Post, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MediaService, type CreateMediaUploadInput } from './media.service';

@Controller('media/uploads')
@UseGuards(OidcBearerGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  async create(
    @Req() request: Request & AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || idempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      throw new BadRequestException('A valid Idempotency-Key header is required.');
    }
    return {
      upload: await this.media.createUpload(requireUserId(request), idempotencyKey, parseInput(body)),
    };
  }

  @Post(':uploadId/complete')
  async complete(
    @Req() request: Request & AuthenticatedRequest,
    @Param('uploadId') uploadId: string,
  ) {
    if (!isUuid(uploadId)) throw new BadRequestException('uploadId must be a valid UUID.');
    return { upload: await this.media.completeUpload(requireUserId(request), uploadId) };
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
}

function parseInput(value: unknown): CreateMediaUploadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }
  const body = value as Record<string, unknown>;
  const allowed = ['fileName', 'contentType', 'sizeBytes', 'checksumSha256'];
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new BadRequestException(`Unexpected fields: ${unexpected.join(', ')}.`);
  if (typeof body.fileName !== 'string' || typeof body.contentType !== 'string'
    || typeof body.sizeBytes !== 'number' || typeof body.checksumSha256 !== 'string') {
    throw new BadRequestException('fileName, contentType, sizeBytes and checksumSha256 are required.');
  }
  return {
    fileName: body.fileName, contentType: body.contentType,
    sizeBytes: body.sizeBytes, checksumSha256: body.checksumSha256,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
