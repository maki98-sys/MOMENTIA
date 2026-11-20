import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SpacesService } from './spaces.service';

@Controller('spaces')
@UseGuards(OidcBearerGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  listMine(@Req() request: Request & AuthenticatedRequest) {
    return this.spaces.listMine(request.userId!);
  }

  @Post()
  create(@Req() request: Request & AuthenticatedRequest, @Body() body: unknown) {
    return this.spaces.create(request.userId!, this.spaces.validateCreateInput(body));
  }

  @Patch(':spaceId/event')
  updateEvent(@Req() request: Request & AuthenticatedRequest,@Param('spaceId') spaceId: string,@Body() body: unknown) {
    return this.spaces.updateEvent(request.userId!,spaceId,body);
  }

  @Patch(':spaceId/lifecycle')
  changeLifecycle(@Req() request: Request & AuthenticatedRequest,@Param('spaceId') spaceId: string,@Body() body: unknown) {
    const action=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).action:undefined;
    return this.spaces.changeLifecycle(request.userId!,spaceId,action);
  }

  @Get(':spaceId')
  getMine(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    return this.spaces.getMine(request.userId!, spaceId);
  }
}
