import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { OidcBearerGuard } from '../auth/oidc-bearer.guard';
import { CoupleJournalService } from './couple-journal.service';
@Controller('spaces/:spaceId/couple-journal')
@UseGuards(OidcBearerGuard)
export class CoupleJournalController{
 constructor(private readonly journal:CoupleJournalService){}
 @Get() list(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Query('limit') limit?:string){return this.journal.list(spaceId,req.userId!,Number(limit)||30);}
 @Post() create(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Body() body:unknown){return this.journal.create(spaceId,req.userId!,body);}
 @Delete(':entryId') remove(@Req() req:Request&AuthenticatedRequest,@Param('spaceId') spaceId:string,@Param('entryId') entryId:string){return this.journal.remove(spaceId,entryId,req.userId!);}
}
