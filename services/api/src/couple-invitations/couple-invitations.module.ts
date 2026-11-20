import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoupleInvitationsController } from './couple-invitations.controller';
import { CoupleInvitationsService } from './couple-invitations.service';
@Module({imports:[AuthModule],controllers:[CoupleInvitationsController],providers:[CoupleInvitationsService]})
export class CoupleInvitationsModule {}
