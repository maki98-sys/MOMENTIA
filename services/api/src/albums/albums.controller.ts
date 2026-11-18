import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { AlbumsService } from './albums.service';
@Controller('spaces/:spaceId/albums')
@UseGuards(OidcBearerGuard)
export class AlbumsController {
 constructor(private readonly albums:AlbumsService){}
 @Get() list(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string){return this.albums.list(req.userId!,spaceId);}
 @Post() create(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Body() body:unknown){return this.albums.create(req.userId!,spaceId,body);}
 @Post(':albumId/items') add(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('albumId') albumId:string,@Body() body:unknown){return this.albums.addItem(req.userId!,spaceId,albumId,body);}
 @Delete(':albumId/items/:itemId') remove(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('albumId') albumId:string,@Param('itemId') itemId:string){return this.albums.removeItem(req.userId!,spaceId,albumId,itemId);}
}
