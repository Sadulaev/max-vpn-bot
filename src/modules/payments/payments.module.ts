import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentSession } from '@database/entities';
import { SubscriptionsModule } from '@modules/subscriptions';
import { UserBotModule } from '@modules/bot';
import { ReferralModule } from '@modules/referral/referral.module';
import { MaxApiModule } from '@modules/max-api';
import { PaymentsService } from './payments.service';
import { FreekassaService } from './freekassa.service';
import { PaymentsController } from './payments.controller';
import { PaymentNotificationService } from './payment-notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentSession]),
    SubscriptionsModule,
    forwardRef(() => UserBotModule),
    ReferralModule,
    MaxApiModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, FreekassaService, PaymentNotificationService],
  exports: [PaymentsService, FreekassaService],
})
export class PaymentsModule {}
