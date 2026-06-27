import { Module, forwardRef } from '@nestjs/common';
import { MaxApiModule } from '@modules/max-api';
import { BotPagesModule } from '@modules/bot-pages';
import { PlansModule } from '@modules/plans';
import { PaymentsModule } from '@modules/payments';
import { SubscriptionsModule } from '@modules/subscriptions';
import { MaxBotController } from './max-bot.controller';
import { MaxBotService } from './max-bot.service';

@Module({
  imports: [
    MaxApiModule,
    BotPagesModule,
    PlansModule,
    forwardRef(() => PaymentsModule),
    SubscriptionsModule,
  ],
  controllers: [MaxBotController],
  providers: [MaxBotService],
  exports: [MaxBotService],
})
export class MaxBotModule {}
