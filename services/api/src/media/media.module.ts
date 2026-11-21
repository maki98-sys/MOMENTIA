import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LocalMediaStorage, MediaStorage, S3MediaStorage } from './media-storage.service';

@Module({
  imports:[AuthModule],
  controllers:[MediaController],
  providers:[
    MediaService,
    LocalMediaStorage,
    S3MediaStorage,
    {
      provide: MediaStorage,
      useFactory: (local: LocalMediaStorage, remote: S3MediaStorage) =>
        process.env.MEDIA_STORAGE_PROVIDER === 's3' ? remote : local,
      inject: [LocalMediaStorage, S3MediaStorage],
    },
  ],
})
export class MediaModule {}
