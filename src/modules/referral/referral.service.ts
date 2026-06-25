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
    try {
      const existing = await this.subscriptionsService.getActiveSubscriptionByTelegramId(referrerId);

      let subPageUrl: string | undefined;
      if (existing) {
        await this.subscriptionsService.extendSubscription(existing.id, REFERRAL_DAYS);
        subPageUrl = (await this.subscriptionsService.getSubPageUrl(existing.id)) ?? undefined;
        this.logger.log(`Referrer ${referrerId}: extended subscription ${existing.id} by ${REFERRAL_DAYS} days`);
      } else {
        const result = await this.subscriptionsService.createSubscription({
          telegramId: referrerId,
          days: REFERRAL_DAYS,
          source: SubscriptionSource.BOT,
          dataLimitGB: 0,
          note: 'Referral reward',
        });
        subPageUrl = result.subPageUrl ?? undefined;
        this.logger.log(`Referrer ${referrerId}: created referral subscription for ${REFERRAL_DAYS} days`);
      }

      await this.notifyReferrer(referrerId, subPageUrl);
    } catch (error) {
      this.logger.error(`Failed to reward referrer ${referrerId}:`, error);
    }
  }

  private async notifyReferrer(
    referrerId: string,
    subPageUrl?: string,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const message =
      `🎉 <b>Реферальный бонус!</b>\n\n` +
      `Пользователь, которого вы пригласили, только что оформил подписку!\n\n` +
      `🎁 <b>Ваш бонус:</b>\n` +
      `✅ <b>+${REFERRAL_DAYS} дней к подписке</b>`;

    const buttons = subPageUrl
      ? { inline_keyboard: [[{ text: '📱 Открыть подписку', url: subPageUrl }]] }
      : undefined;

    try {
      await this.maxApiService.sendMessage(referrerId, message, {
        parse_mode: 'HTML',
        reply_markup: buttons,
      });
    } catch (error) {
      this.logger.error(`Failed to notify referrer ${referrerId}:`, error);
    }
  }
}
