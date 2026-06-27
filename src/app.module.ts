import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './common/config/config';

// Модули
import { AuthModule } from '@modules/auth';
import { PaymentsModule } from '@modules/payments';
import { PlansModule } from '@modules/plans';
import { DeviceSlotPlansModule } from '@modules/device-slot-plans/device-slot-plans.module';
import { RemnawaveApiModule } from '@modules/remnawave-api';
import { SubscriptionsModule } from '@modules/subscriptions';
import { TasksModule } from '@modules/tasks';
import { ReferralModule } from '@modules/referral/referral.module';
import { BotPagesModule } from '@modules/bot-pages';
import { MaxApiModule } from '@modules/max-api';
import { MaxBotModule } from '@modules/max-bot';

// Interceptors
import { TelegrafErrorInterceptor } from '@common/interceptors/telegraf-error.interceptor';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    // Конфигурация
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Задачи по расписанию (cron)
    ScheduleModule.forRoot(),

    // База данных
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: configuration().database.host,
      port: configuration().database.port,
      username: configuration().database.username,
      password: configuration().database.password,
      database: configuration().database.database,
      synchronize: true,
      autoLoadEntities: true,
    }),

    // Функциональные модули
    AuthModule,
    MaxApiModule,
    MaxBotModule,
    RemnawaveApiModule,
    SubscriptionsModule,
    PaymentsModule,
    PlansModule,
    DeviceSlotPlansModule,
    TasksModule,
    ReferralModule,
    BotPagesModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TelegrafErrorInterceptor,
    },
  ],
})
export class AppModule {}

