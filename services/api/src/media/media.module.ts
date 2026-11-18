import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { S3CompatibleStorageService } from './s3-compatible-storage.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [MediaService, S3CompatibleStorageService],
  exports: [MediaService],
})
export class MediaModule {}
