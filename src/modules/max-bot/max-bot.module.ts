import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaxApiModule } from '@modules/max-api';
import { SubscriptionsModule } from '@modules/subscriptions';
import { PlansModule } from '@modules/plans';
import { DeviceSlotPlansModule } from '@modules/device-slot-plans';
import { PaymentsModule } from '@modules/payments';
import { ReferralModule } from '@modules/referral';
import { Subscription } from '@database/entities';
import { MaxBotController } from './max-bot.controller';
import { MaxBotService } from './max-bot.service';

@Module({
  imports: [
    MaxApiModule,
    TypeOrmModule.forFeature([Subscription]),
    forwardRef(() => SubscriptionsModule),
    PlansModule,
    DeviceSlotPlansModule,
    forwardRef(() => PaymentsModule),
    forwardRef(() => ReferralModule),
  ],
  controllers: [MaxBotController],
  providers: [MaxBotService],
  exports: [MaxBotService],
})
export class MaxBotModule {}