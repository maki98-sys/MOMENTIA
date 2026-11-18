import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { EventAlbumsController } from './event-albums.controller';
import { EventAlbumsService } from './event-albums.service';

@Module({
  imports: [AuthModule],
  controllers: [SpacesController, EventAlbumsController],
  providers: [SpacesService, EventAlbumsService],
  exports: [SpacesService, EventAlbumsService],
})
export class SpacesModule {}
