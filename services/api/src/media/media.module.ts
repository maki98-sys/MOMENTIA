import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaProcessingController } from './media-processing.controller';
import { MediaProcessingService } from './media-processing.service';
import { MediaService } from './media.service';

@Module({
  imports: [AuthModule],
  controllers: [MediaController, MediaProcessingController],
  providers: [MediaService, MediaProcessingService],
  exports: [MediaService, MediaProcessingService],
})
export class MediaModule {}
