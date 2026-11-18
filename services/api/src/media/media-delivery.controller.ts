import {
  BadRequestException, Controller, Get, Param, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { MediaService } from './media.service';

const VARIANTS = new Set(['original', 'thumbnail', 'preview', 'display']);

@Controller('media')
@UseGuards(OidcBearerGuard)
export class MediaDeliveryController {
  constructor(private readonly media: MediaService) {}

  @Get(':mediaAssetId/variants/:variant')
  async getVariant(
    @Req() request: Request & AuthenticatedRequest,
    @Param('mediaAssetId') mediaAssetId: string,
    @Param('variant') variant: string,
  ) {
    if (!isUuid(mediaAssetId)) throw new BadRequestException('mediaAssetId must be a valid UUID.');
    if (!VARIANTS.has(variant)) {
      throw new BadRequestException('variant must be original, thumbnail, preview or display.');
    }
    if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
    return {
      media: await this.media.getVariantUrl(
        request.userId,
        mediaAssetId,
        variant as 'original' | 'thumbnail' | 'preview' | 'display',
      ),
    };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
