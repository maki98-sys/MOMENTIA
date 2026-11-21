import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalMediaStorage, MediaStorage } from './media-storage.service';
@Module({
  imports:[AuthModule],
  controllers:[MediaController],
  providers:[
    MediaService,
    LocalMediaStorage,
    { provide: MediaStorage, useExisting: LocalMediaStorage },
  ],
})
export class MediaModule {}
