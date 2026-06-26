import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsModule } from '@modules/payments';
import { SubscriptionsModule } from '@modules/subscriptions';
import { RemnawaveApiModule } from '@modules/remnawave-api';
import { BotState, Plan, DeviceSlotPlan } from '@database/entities';
import { DeviceSlotPlansModule } from '@modules/device-slot-plans/device-slot-plans.module';
import { BotPagesModule } from '@modules/bot-pages';
import { UserBotService } from './services/user-bot.service';
import { UserBotUpdate } from './user-bot.update';
import { MaxApiModule } from '@modules/max-api/max-api.module';

@Module({
  imports: [
    forwardRef(() => PaymentsModule),
    forwardRef(() => SubscriptionsModule),
    RemnawaveApiModule,
    TypeOrmModule.forFeature([BotState, Plan, DeviceSlotPlan]),
    DeviceSlotPlansModule,
    BotPagesModule,
    MaxApiModule,
  ],
  providers: [UserBotService, UserBotUpdate],
  exports: [UserBotService],
})
export class UserBotModule {}

