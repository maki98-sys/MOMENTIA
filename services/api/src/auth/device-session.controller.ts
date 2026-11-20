import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth.types';
import { OidcBearerGuard } from './oidc-bearer.guard';
import { DeviceSessionService } from './device-session.service';

@Controller('auth')
@UseGuards(OidcBearerGuard)
export class DeviceSessionController {
  constructor(private readonly devices: DeviceSessionService) {}

  @Post('devices')
  register(@Req() req: Request & AuthenticatedRequest, @Body() body: unknown) {
    return this.devices.registerDevice(req.userId!, body);
  }

  @Get('devices')
  listDevices(@Req() req: Request & AuthenticatedRequest) {
    return this.devices.listDevices(req.userId!);
  }

  @Post('devices/:deviceId/heartbeat')
  heartbeat(@Req() req: Request & AuthenticatedRequest, @Param('deviceId') deviceId: string) {
    return this.devices.heartbeat(req.userId!, deviceId);
  }

  @Delete('devices/:deviceId')
  revokeDevice(@Req() req: Request & AuthenticatedRequest, @Param('deviceId') deviceId: string) {
    return this.devices.revokeDevice(req.userId!, deviceId);
  }

  @Get('sessions')
  listSessions(@Req() req: Request & AuthenticatedRequest) {
    return this.devices.listSessions(req.userId!);
  }

  @Delete('sessions/:sessionId')
  revokeSession(@Req() req: Request & AuthenticatedRequest, @Param('sessionId') sessionId: string) {
    return this.devices.revokeSession(req.userId!, sessionId);
  }

  @Delete('sessions')
  revokeAllSessions(@Req() req: Request & AuthenticatedRequest) {
    return this.devices.revokeAllSessions(req.userId!);
  }
}
