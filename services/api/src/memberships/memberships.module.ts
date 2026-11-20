import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsController } from './memberships.controller';
import { MembershipsService } from './memberships.service';
import { JoinRequestsController } from './join-requests.controller';
import { JoinRequestsService } from './join-requests.service';

@Module({ imports: [AuthModule], controllers: [MembershipsController, JoinRequestsController], providers: [MembershipsService, JoinRequestsService] })
export class MembershipsModule {}
