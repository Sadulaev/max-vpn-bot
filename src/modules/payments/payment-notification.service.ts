import { Injectable, Logger } from '@nestjs/common';
import { MaxApiService } from '@modules/max-api';


@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    private readonly maxApiService: MaxApiService,
  ) {}

  /**
   * Уведомить пользователя об успешной оплате
   */
  async notifyPaymentSuccess(
    telegramId: string,
    subscriptionUrl: string,
    period: number,
    _isAntiThrottling: boolean,
    subPageUrl: string | null,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const periodLabel = this.getPeriodLabel(period);

    const buttons: any[][] = [];
    if (subPageUrl) {
      buttons.push([{ text: '📱 Подключить устройство', url: subPageUrl }]);
    }
    buttons.push(
      [{ text: '📡 Моя подписка', url: subPageUrl ?? subscriptionUrl }],
      [{ text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' }],
      [{ text: '📖 Инструкции', url: subPageUrl ?? subscriptionUrl }],
    );

    const periodText = ` на <b>${periodLabel}</b>`;

    const message = `✅ <b>Оплата получена!</b>

Доступ <b>VPN HIT</b> успешно оформлен${periodText}.

🔗 <b>Ссылка на подписку</b> (нажмите, чтобы скопировать):

<code>${subscriptionUrl}</code>`;

    try {
      await this.maxApiService.sendMessage(telegramId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
      this.logger.log(`Payment success notification sent to ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to send notification to ${telegramId}:`, error);
    }
  }

  /**
   * Уведомить об ошибке генерации ключа
   */
  async notifyKeyGenerationError(telegramId: string): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const message = `⚠️ <b>Произошла ошибка</b>

Оплата получена, но возникла проблема с активацией доступа.
Пожалуйста, обратитесь в поддержку: @vpn_hit_support`;

    try {
      await this.maxApiService.sendMessage(telegramId, message, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Failed to send error notification to ${telegramId}:`, error);
    }
  }

  private getPeriodLabel(months: number): string {
    if (months === 1) return '1 месяц';
    if (months >= 2 && months <= 4) return `${months} месяца`;
    return `${months} месяцев`;
  }

  /**
   * Уведомить об успешной покупке слотов устройств
   */
  async notifyDeviceSlotsSuccess(
    telegramId: string,
    slotsCount: number,
    newLimit: number,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const message =
      `✅ <b>Слоты устройств добавлены!</b>\n\n` +
      `➕ Добавлено: <b>${slotsCount}</b> ${slotsCount === 1 ? 'устройство' : slotsCount < 5 ? 'устройства' : 'устройств'}\n` +
      `💻 Новый лимит: <b>${newLimit}</b> устройств`;

    try {
      await this.maxApiService.sendMessage(telegramId, message, {
        parse_mode: 'HTML',
      });
      this.logger.log(`Device slots notification sent to ${telegramId}`);
    } catch (error) {
      this.logger.error(`Failed to send device slots notification to ${telegramId}:`, error);
    }
  }
}

