import { Module } from '@nestjs/common';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { AccountDeletionWorkerController } from './account-deletion-worker.controller';

@Module({
  controllers: [PrivacyController, AccountDeletionWorkerController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
