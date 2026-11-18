import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';
import { ConnectionsSelfController } from './connections-self.controller';

@Module({
  imports: [AuthModule],
  controllers: [PostsController, ConnectionsController, ConnectionsSelfController],
  providers: [PostsService, ConnectionsService],
  exports: [PostsService, ConnectionsService],
})
export class SocialModule {}
