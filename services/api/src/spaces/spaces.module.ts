import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SpacesController } from './spaces.controller';
import { SpacesService } from './spaces.service';
import { EventsWorkerController } from './events-worker.controller';

@Module({
  imports: [AuthModule],
  controllers: [SpacesController, EventsWorkerController],
  providers: [SpacesService],
})
export class SpacesModule {}
