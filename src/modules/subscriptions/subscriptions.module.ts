import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '@database/entities';
import { RemnawaveApiModule } from '@modules/remnawave-api';
import { UserBotModule } from '@modules/bot';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionPublicController } from './subscription-public.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription]),
    RemnawaveApiModule,
    forwardRef(() => UserBotModule),
  ],
  controllers: [SubscriptionsController, SubscriptionPublicController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
