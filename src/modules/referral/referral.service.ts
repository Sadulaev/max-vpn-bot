import { Injectable, Logger } from '@nestjs/common';
import { SubscriptionsService } from '@modules/subscriptions';
import { MaxApiService } from '@modules/max-api';
import type { NewMessageBody } from '@modules/max-api';

const REFERRAL_DAYS = 10;

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly maxApiService: MaxApiService,
  ) {}

  /**
   * Выдаёт реферальное вознаграждение пригласившему пользователю
   * при покупке основной подписки.
   */
  async rewardReferrer(referrerId: string): Promise<void> {
    try {
      const subscription = await this.subscriptionsService.getActiveSubscriptionByMaxId(referrerId);

      if (!subscription) {
        this.logger.warn(`Referrer ${referrerId} has no active subscription — skipping bonus`);
        return;
      }

      await this.subscriptionsService.extendSubscription(
        subscription.id,
        REFERRAL_DAYS,
        0,
      );

      this.logger.log(`Referral bonus: extended sub ${subscription.id} by ${REFERRAL_DAYS} days for referrer ${referrerId}`);

      let subPageUrl: string | null = null;
      try {
        subPageUrl = await this.subscriptionsService.getSubPageUrl(subscription.id);
      } catch {
        subPageUrl = null;
      }

      await this.notifyReferrer(referrerId, subPageUrl ?? undefined);
    } catch (err: unknown) {
      this.logger.error(`rewardReferrer failed for ${referrerId}: ${(err as Error)?.message}`);
    }
  }

  private async notifyReferrer(
    referrerId: string,
    subPageUrl?: string,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const userId = parseInt(referrerId, 10);
    if (isNaN(userId)) return;

    const buttons = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link' as const, text: '🔑 Моя подписка', url: subPageUrl }]);
    }

    buttons.push([{ type: 'callback' as const, text: '◀️ Главное меню', payload: 'main_menu' }]);

    const body: NewMessageBody = {
      text:
        `🎁 **Реферальный бонус начислен!**\n\n` +
        `Ваш друг купил подписку, и вы получили **+${REFERRAL_DAYS} дней** к вашей подписке. Спасибо за приглашение!`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };

    await this.maxApiService.sendMessage(userId, body);
    this.logger.log(`Referral bonus notification sent to user ${userId}`);
  }
}
