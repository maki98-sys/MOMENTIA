import { Body, Controller, Get, Param, Patch, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { NotificationsService } from './notifications.service';

@Controller('me/notifications')
@UseGuards(OidcBearerGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Req() request: Request & AuthenticatedRequest,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notifications.list(
      request.userId!,
      cursor,
      Number(limit) || 30,
      unreadOnly === 'true',
    );
  }

  @Patch(':notificationId/read')
  markRead(
    @Req() request: Request & AuthenticatedRequest,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notifications.markRead(request.userId!, notificationId);
  }

  @Patch('read-all')
  markAllRead(@Req() request: Request & AuthenticatedRequest) {
    return this.notifications.markAllRead(request.userId!);
  }
  @Get('preferences')
  listPreferences(@Req() request: Request & AuthenticatedRequest) {
    return this.notifications.listPreferences(request.userId!);
  }

  @Put('preferences/:category')
  setPreference(
    @Req() request: Request & AuthenticatedRequest,
    @Param('category') category: string,
    @Body() body: unknown,
  ) {
    return this.notifications.setPreference(request.userId!, category, body);
  }

}
