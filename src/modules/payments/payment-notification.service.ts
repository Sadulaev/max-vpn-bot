import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MaxApiService } from '@modules/max-api';
import type { NewMessageBody, MaxButtonRow } from '@modules/max-api';

@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    private readonly maxApiService: MaxApiService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Уведомить пользователя об успешной оплате
   */
  async notifyPaymentSuccess(
    maxId: string,
    subscriptionUrl: string,
    period: number,
    subPageUrl: string | null,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const userId = parseInt(maxId, 10);
    if (isNaN(userId)) {
      this.logger.warn(`Invalid maxId: ${maxId}`);
      return;
    }

    const periodLabel = this.getPeriodLabel(period);

    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else if (subscriptionUrl) {
      buttons.push([{ type: 'clipboard', text: '📋 Скопировать ключ подписки', payload: subscriptionUrl }]);
    }

    buttons.push([{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }]);

    const body: NewMessageBody = {
      text:
        `🎉 **Подписка успешно активирована!**\n\n` +
        `Срок: **${periodLabel}**\n\n` +
        `На вашей странице подписки вы найдёте ключ доступа и инструкцию по подключению.`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };

    await this.maxApiService.sendMessage(userId, body);
    this.logger.log(`Payment success notification sent to user ${userId}`);
  }

  /**
   * Уведомить об ошибке генерации ключа
   */
  async notifyKeyGenerationError(maxId: string): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const userId = parseInt(maxId, 10);
    if (isNaN(userId)) return;

    const body: NewMessageBody = {
      text:
        `⚠️ **Ошибка активации подписки**\n\n` +
        `Оплата прошла успешно, но произошла ошибка при активации. Мы уже разбираемся.\n\n` +
        `Пожалуйста, обратитесь в поддержку, указав ваш ID: \`${maxId}\``,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'callback', text: '🛟 Поддержка', payload: 'support' }],
              [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
            ],
          },
        },
      ],
    };

    await this.maxApiService.sendMessage(userId, body);
    this.logger.warn(`Key generation error notification sent to user ${userId}`);
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
    maxId: string,
    slotsCount: number,
    newLimit: number,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const userId = parseInt(maxId, 10);
    if (isNaN(userId)) return;

    const body: NewMessageBody = {
      text:
        `✅ **Слоты устройств добавлены!**\n\n` +
        `Куплено слотов: **${slotsCount}**\n` +
        `Новый лимит устройств: **${newLimit}**`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
            ],
          },
        },
      ],
    };

    await this.maxApiService.sendMessage(userId, body);
    this.logger.log(`Device slots success notification sent to user ${userId}`);
  }

  /**
   * Отправить HTML-сообщение в Telegram-канал уведомлений.
   * Требует TELEGRAM_BOT_TOKEN и TG_NOTIFICATION_CHANNEL_ID в конфигурации.
   */
  async sendChannelNotification(htmlMessage: string): Promise<void> {
    const botToken = this.configService.get<string>('telegram.botToken', '');
    const channelId = this.configService.get<string>('telegram.notificationChannelId', '');

    if (!botToken || !channelId) {
      this.logger.debug('Telegram channel notification skipped: TELEGRAM_BOT_TOKEN or TG_NOTIFICATION_CHANNEL_ID not set');
      return;
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, text: htmlMessage, parse_mode: 'HTML' }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`Telegram channel notification failed (${res.status}): ${text}`);
    } else {
      this.logger.log('Telegram channel notification sent');
    }
  }
}

