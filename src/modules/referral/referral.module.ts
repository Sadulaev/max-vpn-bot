import { Module, forwardRef } from '@nestjs/common';
import { SubscriptionsModule } from '@modules/subscriptions';
import { MaxApiModule } from '@modules/max-api';
import { ReferralService } from './referral.service';

@Module({
  imports: [forwardRef(() => SubscriptionsModule), MaxApiModule],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
