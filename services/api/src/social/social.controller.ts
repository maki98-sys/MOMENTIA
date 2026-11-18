import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { SocialService } from './social.service';

@Controller()
@UseGuards(OidcBearerGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}
  @Get('feed')
  feed(@Req() req: Request & AuthenticatedRequest,@Query('cursor') cursor?:string,@Query('limit') limit?:string) {
    return this.social.feed(req.userId!,cursor,Number(limit)||20);
  }
  @Post('posts')
  create(@Req() req: Request & AuthenticatedRequest,@Body() body:unknown) { return this.social.create(req.userId!,body); }
  @Get('posts/:postId/comments')
  comments(@Req() req: Request & AuthenticatedRequest,@Param('postId') id:string) { return this.social.comments(req.userId!,id); }
  @Post('posts/:postId/comments')
  comment(@Req() req: Request & AuthenticatedRequest,@Param('postId') id:string,@Body() body:{body?:unknown}) { return this.social.addComment(req.userId!,id,body?.body); }
  @Post('posts/:postId/reactions')
  react(@Req() req: Request & AuthenticatedRequest,@Param('postId') id:string,@Body() body:{reaction?:unknown}) { return this.social.react(req.userId!,id,body?.reaction); }
  @Delete('posts/:postId/reactions')
  unreact(@Req() req: Request & AuthenticatedRequest,@Param('postId') id:string) { return this.social.removeReaction(req.userId!,id); }
}
