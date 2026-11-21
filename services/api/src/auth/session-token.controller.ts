import { Body, Controller, Post, Req, UseGuards, BadRequestException, Delete } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { SessionTokenService } from './session-token.service';
import { DeviceSessionService } from './device-session.service';

@Controller('auth')
export class AuthSessionController {
  constructor(
    private readonly sessions: SessionTokenService,
    private readonly devices: DeviceSessionService,
  ) {}

  @Post('sessions')
  @UseGuards(OidcBearerGuard)
  create(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    if (!req.auth) throw new BadRequestException('An OIDC provider token is required to create a MOMENTIA session.');
    const value = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string,unknown> : {};
    if (Object.keys(value).some(key => key !== 'deviceId')) {
      throw new BadRequestException('Only deviceId is accepted.');
    }
    if (value.deviceId !== undefined && (typeof value.deviceId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.deviceId))) {
      throw new BadRequestException('Invalid deviceId.');
    }
    const userAgent = req.headers['user-agent'];
    return this.sessions.create(req.userId!,value.deviceId as string|undefined,{
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ipAddress: req.ip,
    });
  }

  @Post('sessions/refresh')
  refresh(@Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body as Record<string,unknown>).some(key => key !== 'refreshToken') ||
        typeof (body as Record<string,unknown>).refreshToken !== 'string') {
      throw new BadRequestException('A refreshToken is required.');
    }
    return this.sessions.refresh((body as {refreshToken:string}).refreshToken);
  }

  @Delete('sessions/current')
  @UseGuards(OidcBearerGuard)
  logout(@Req() req: Request & AuthenticatedRequest) {
    if (!req.sessionId) throw new BadRequestException('A MOMENTIA session token is required.');
    return this.devices.revokeSession(req.userId!,req.sessionId);
  }
}
