import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoupleJournalController } from './couple-journal.controller';
import { CoupleJournalService } from './couple-journal.service';
@Module({imports:[AuthModule],controllers:[CoupleJournalController],providers:[CoupleJournalService]})
export class CoupleJournalModule {}
