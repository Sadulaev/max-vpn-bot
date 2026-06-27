import { Module } from '@nestjs/common';
import { PlansModule } from '@modules/plans';
import { SubscriptionsModule } from '@modules/subscriptions';
import { BotPagesService } from './bot-pages.service';

@Module({
  imports: [PlansModule, SubscriptionsModule],
  providers: [BotPagesService],
  exports: [BotPagesService],
})
export class BotPagesModule {}
