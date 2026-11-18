import {
  BadRequestException, Controller, Delete, Param, Post, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { ConnectionsService } from './connections.service';

@Controller('users/:userId')
@UseGuards(OidcBearerGuard)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Post('follow')
  async follow(@Req() request: Request & AuthenticatedRequest, @Param('userId') targetId: string) {
    assertUuid(targetId);
    return { relationship: await this.connections.follow(requireUserId(request), targetId) };
  }

  @Delete('follow')
  async unfollow(@Req() request: Request & AuthenticatedRequest, @Param('userId') targetId: string) {
    assertUuid(targetId);
    return this.connections.unfollow(requireUserId(request), targetId);
  }

  @Post('follow/accept')
  async accept(@Req() request: Request & AuthenticatedRequest, @Param('userId') requesterId: string) {
    assertUuid(requesterId);
    return { relationship: await this.connections.accept(requireUserId(request), requesterId) };
  }

  @Post('follow/reject')
  async reject(@Req() request: Request & AuthenticatedRequest, @Param('userId') requesterId: string) {
    assertUuid(requesterId);
    return { relationship: await this.connections.reject(requireUserId(request), requesterId) };
  }

  @Post('block')
  async block(@Req() request: Request & AuthenticatedRequest, @Param('userId') targetId: string) {
    assertUuid(targetId);
    return this.connections.block(requireUserId(request), targetId);
  }

  @Delete('block')
  async unblock(@Req() request: Request & AuthenticatedRequest, @Param('userId') targetId: string) {
    assertUuid(targetId);
    return this.connections.unblock(requireUserId(request), targetId);
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('userId must be a valid UUID.');
  }
}
