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
    maxId: string,
    subscriptionUrl: string,
    period: number,
    subPageUrl: string | null,
  ): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    const periodLabel = this.getPeriodLabel(period);

    // TODO: отпровить уведомление о покупке подписки вместе с ссылкой на подписку пользователю через Max API
  }

  /**
   * Уведомить об ошибке генерации ключа
   */
  async notifyKeyGenerationError(maxId: string): Promise<void> {
    if (!this.maxApiService.isConfigured()) return;

    // TODO: отправить уведомление пользователю о том, что произошла ошибка генерации ключа
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

    // TODO: отправить уведомление пользователю о том, что он успешно купил слоты устройств и его новый лимит устройств
  }
}

