import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '@database/entities';
import { RemnawaveApiModule } from '@modules/remnawave-api';
import { MaxApiModule } from '@modules/max-api';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionPublicController } from './subscription-public.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription]),
    RemnawaveApiModule,
    MaxApiModule,
  ],
  controllers: [SubscriptionsController, SubscriptionPublicController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription]),
    RemnawaveApiModule,
  ],
  controllers: [SubscriptionsController, SubscriptionPublicController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
