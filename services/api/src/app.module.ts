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
import { CoupleJournalModule } from './couple-journal/couple-journal.module';
import { CoupleInvitationsModule } from './couple-invitations/couple-invitations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AudioModule } from './audio/audio.module';
import { ModerationModule } from './moderation/moderation.module';
import { BillingModule } from './billing/billing.module';

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
    CoupleJournalModule,
    CoupleInvitationsModule,
    NotificationsModule,
    AudioModule,
    ModerationModule,
    BillingModule,
  ],
})
export class AppModule {}
