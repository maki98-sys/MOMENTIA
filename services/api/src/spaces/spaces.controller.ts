import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { SpacesService } from './spaces.service';
import type {
  CreateInvitationInput,
  CreateSpaceInput,
  SpaceType,
  SpaceVisibility,
} from './space.types';

@Controller()
@UseGuards(OidcBearerGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Post('spaces')
  async create(@Req() request: Request & AuthenticatedRequest, @Body() body: unknown) {
    return { space: await this.spaces.create(requireUserId(request), parseCreateSpace(body)) };
  }

  @Get('spaces')
  async listMine(@Req() request: Request & AuthenticatedRequest) {
    return { spaces: await this.spaces.listMine(requireUserId(request)) };
  }

  @Get('spaces/:spaceId')
  async getMine(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    assertUuid(spaceId, 'spaceId');
    return { space: await this.spaces.getMine(requireUserId(request), spaceId) };
  }


  @Get('spaces/:spaceId/members')
  async listMembers(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    assertUuid(spaceId, 'spaceId');
    return { members: await this.spaces.listMembers(requireUserId(request), spaceId) };
  }

  @Patch('spaces/:spaceId/members/:memberId/role')
  async updateMemberRole(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
    @Body() body: unknown,
  ) {
    assertUuid(spaceId, 'spaceId');
    assertUuid(memberId, 'memberId');
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required.');
    }
    const input = body as Record<string, unknown>;
    rejectUnexpected(input, new Set(['role']));
    const role = input.role;
    if (role !== 'admin' && role !== 'moderator' && role !== 'member' && role !== 'guest') {
      throw new BadRequestException('role must be admin, moderator, member or guest.');
    }
    await this.spaces.updateMemberRole(requireUserId(request), spaceId, memberId, role);
    return { success: true };
  }

  @Delete('spaces/:spaceId/members/:memberId')
  async removeMember(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Param('memberId') memberId: string,
  ) {
    assertUuid(spaceId, 'spaceId');
    assertUuid(memberId, 'memberId');
    await this.spaces.removeMember(requireUserId(request), spaceId, memberId);
    return { success: true };
  }

  @Post('spaces/:spaceId/leave')
  async leaveSpace(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
  ) {
    assertUuid(spaceId, 'spaceId');
    await this.spaces.leaveSpace(requireUserId(request), spaceId);
    return { success: true };
  }

  @Post('spaces/:spaceId/invitations')
  async createInvitation(
    @Req() request: Request & AuthenticatedRequest,
    @Param('spaceId') spaceId: string,
    @Body() body: unknown,
  ) {
    assertUuid(spaceId, 'spaceId');
    return {
      invitation: await this.spaces.createInvitation(
        requireUserId(request),
        spaceId,
        parseInvitation(body),
      ),
    };
  }

  @Post('invitations/accept')
  async acceptInvitation(@Req() request: Request & AuthenticatedRequest, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A JSON object is required.');
    }
    const token = (body as Record<string, unknown>).token;
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) {
      throw new BadRequestException('token must be a valid invitation token.');
    }
    return { membership: await this.spaces.acceptInvitation(requireUserId(request), token) };
  }
}

function requireUserId(request: AuthenticatedRequest): string {
  if (!request.userId) throw new UnauthorizedException('Authenticated user context is missing.');
  return request.userId;
}

function parseCreateSpace(value: unknown): CreateSpaceInput {
  const body = requireObject(value);
  const allowed = new Set([
    'type', 'name', 'visibility', 'partnerUserId', 'startsAt', 'endsAt',
    'timezone', 'description', 'joinPolicy',
  ]);
  rejectUnexpected(body, allowed);
  if (body.type !== 'EVENT' && body.type !== 'COUPLE' && body.type !== 'CIRCLE') {
    throw new BadRequestException('type must be EVENT, COUPLE or CIRCLE.');
  }
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {
    throw new BadRequestException('name must contain between 1 and 120 characters.');
  }
  const visibility = body.visibility ?? 'private';
  if (visibility !== 'public' && visibility !== 'unlisted' && visibility !== 'private') {
    throw new BadRequestException('visibility must be public, unlisted or private.');
  }
  if (body.partnerUserId !== undefined &&
      (typeof body.partnerUserId !== 'string' || !isUuid(body.partnerUserId))) {
    throw new BadRequestException('partnerUserId must be a valid UUID.');
  }

  const input: CreateSpaceInput = {
    type: body.type as SpaceType,
    name: body.name.trim(),
    visibility: visibility as SpaceVisibility,
  };
  if (body.partnerUserId) input.partnerUserId = body.partnerUserId as string;

  if (input.type === 'EVENT') {
    if (body.startsAt !== undefined && body.startsAt !== null && !isIsoDate(body.startsAt)) {
      throw new BadRequestException('startsAt must be a valid ISO date.');
    }
    if (body.endsAt !== undefined && body.endsAt !== null && !isIsoDate(body.endsAt)) {
      throw new BadRequestException('endsAt must be a valid ISO date.');
    }
    if (body.startsAt && body.endsAt &&
        new Date(body.endsAt as string).getTime() < new Date(body.startsAt as string).getTime()) {
      throw new BadRequestException('endsAt cannot be earlier than startsAt.');
    }
    const timezone = body.timezone ?? 'UTC';
    if (typeof timezone !== 'string' || timezone.length > 80 || !isTimezone(timezone)) {
      throw new BadRequestException('timezone must be a valid IANA time zone.');
    }
    input.startsAt = body.startsAt as string | null | undefined;
    input.endsAt = body.endsAt as string | null | undefined;
    input.timezone = timezone;
  }

  if (input.type === 'CIRCLE') {
    if (body.description !== undefined && body.description !== null &&
        (typeof body.description !== 'string' || body.description.length > 500)) {
      throw new BadRequestException('description must be at most 500 characters or null.');
    }
    const joinPolicy = body.joinPolicy ?? 'invite';
    if (joinPolicy !== 'invite' && joinPolicy !== 'approval') {
      throw new BadRequestException('joinPolicy must be invite or approval.');
    }
    input.description = body.description as string | null | undefined;
    input.joinPolicy = joinPolicy;
  }
  if (input.type === 'COUPLE' && !input.partnerUserId) {
    throw new BadRequestException('partnerUserId is required for a COUPLE space.');
  }
  return input;
}

function parseInvitation(value: unknown): CreateInvitationInput {
  const body = requireObject(value);
  rejectUnexpected(body, new Set(['role', 'expiresInHours', 'maxUses']));
  const role = body.role ?? 'member';
  if (role !== 'admin' && role !== 'moderator' && role !== 'member' && role !== 'guest') {
    throw new BadRequestException('role must be admin, moderator, member or guest.');
  }
  const expiresInHours = body.expiresInHours ?? 72;
  if (!Number.isInteger(expiresInHours) || (expiresInHours as number) < 1 || (expiresInHours as number) > 720) {
    throw new BadRequestException('expiresInHours must be between 1 and 720.');
  }
  const maxUses = body.maxUses ?? 1;
  if (!Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 100) {
    throw new BadRequestException('maxUses must be between 1 and 100.');
  }
  return { role, expiresInHours: expiresInHours as number, maxUses: maxUses as number };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function rejectUnexpected(body: Record<string, unknown>, allowed: Set<string>): void {
  const unexpected = Object.keys(body).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new BadRequestException(`Unexpected fields: ${unexpected.join(', ')}.`);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function assertUuid(value: string, field: string): void {
  if (!isUuid(value)) throw new BadRequestException(`${field} must be a valid UUID.`);
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
