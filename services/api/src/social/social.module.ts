import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [AuthModule],
  controllers: [PostsController, ConnectionsController],
  providers: [PostsService, ConnectionsService],
  exports: [PostsService, ConnectionsService],
})
export class SocialModule {}
