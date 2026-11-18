import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { SpacesModule } from './spaces/spaces.module';
import { SocialModule } from './social/social.module';
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
    ProfilesModule,
    SpacesModule,
    SocialModule,
    MediaModule,
  ],
})
export class AppModule {}
