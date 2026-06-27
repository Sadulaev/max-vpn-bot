import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '@modules/subscriptions';
import { SubscriptionSource } from '@database/entities';
import { MaxApiService } from '@modules/max-api';

const REFERRAL_DAYS = 10;

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly maxApiService: MaxApiService,
  ) {}

  /**
   * Выдаёт реферальное вознаграждение пригласившему пользователю
   * при покупке основной подписки.
   *
   * Новый контракт:
   *   - одна подписка на пользователя
   *   - бонус = +10 дней
   */
  async rewardReferrer(referrerId: string): Promise<void> {
    // TODO: Реализовать функцию награды пригласившего пользователя при покупке основной подписки.
  }

  private async notifyReferrer(
    referrerId: string,
    subPageUrl?: string,
  ): Promise<void> {
    // TODO: Реализовать функцию уведомления пригласившего пользователя о начислении бонуса.
  }
}
