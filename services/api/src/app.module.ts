import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfileModule } from './profile/profile.module';
import { SpacesModule } from './spaces/spaces.module';
import { InvitationsModule } from './invitations/invitations.module';
import { MembershipsModule } from './memberships/memberships.module';
import { SocialModule } from './social/social.module';
import { TimelineModule } from './timeline/timeline.module';
import { AlbumsModule } from './albums/albums.module';
import { MediaModule } from './media/media.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    ProfileModule,
    SpacesModule,
    InvitationsModule,
    MembershipsModule,
    SocialModule,
    TimelineModule,
    AlbumsModule,
    MediaModule,
  ],
})
export class AppModule {}
