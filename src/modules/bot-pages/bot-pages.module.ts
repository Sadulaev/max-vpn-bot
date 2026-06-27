import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlansModule } from '@modules/plans';
import { SubscriptionsModule } from '@modules/subscriptions';
import { BotPage } from '@database/entities';
import { BotPagesService } from './bot-pages.service';
import { BotPagesController } from './bot-pages.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BotPage]), PlansModule, SubscriptionsModule],
  controllers: [BotPagesController],
  providers: [BotPagesService],
  exports: [BotPagesService],
})
export class BotPagesModule {}
