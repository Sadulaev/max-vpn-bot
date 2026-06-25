import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatSession, SiteUser } from '@database/entities';
import { SantaChatController } from './santa-chat.controller';
import { SantaChatService } from './santa-chat.service';
import { SiteAuthController } from './site-auth.controller';
import { SiteAuthService } from './site-auth.service';
import { SiteJwtStrategy } from './site-jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatSession, SiteUser]),
    HttpModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cs: ConfigService) => ({
        secret: cs.get<string>('SITE_JWT_SECRET', cs.get<string>('JWT_SECRET', 'site-secret-change-me')),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [SantaChatController, SiteAuthController],
  providers: [SantaChatService, SiteAuthService, SiteJwtStrategy],
  exports: [SantaChatService],
})
export class SantaChatModule {}
