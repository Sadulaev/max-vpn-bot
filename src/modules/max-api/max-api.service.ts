import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  NewMessageBody,
  MaxSendMessageResponse,
  MaxAnswerCallbackResponse,
  MaxBotInfo,
} from './types';

@Injectable()
export class MaxApiService implements OnModuleInit {
  private readonly logger = new Logger(MaxApiService.name);

  private apiUrl!: string;
  private botToken!: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    this.apiUrl = this.configService.get<string>('max.apiUrl', 'https://platform-api2.max.ru');
    this.botToken = this.configService.get<string>('max.botToken', '');

    if (!this.botToken) {
      this.logger.warn('MAX_BOT_TOKEN is not set — MAX bot integration disabled');
    }
  }

  isConfigured(): boolean {
    return !!this.botToken;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.botToken,
      'Content-Type': 'application/json',
    };
  }

  // ─── Bot info ───

  async getMe(): Promise<MaxBotInfo | null> {
    if (!this.isConfigured()) return null;

    const res = await fetch(`${this.apiUrl}/me`, {
      method: 'GET',
      headers: this.headers(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`getMe failed (${res.status}): ${text}`);
      return null;
    }

    return res.json() as Promise<MaxBotInfo>;
  }

  // ─── Messages ───

  /**
   * Отправить сообщение пользователю.
   * @param userId  MAX user_id получателя
   * @param body    Тело сообщения (текст + вложения)
   */
  async sendMessage(userId: number, body: NewMessageBody): Promise<MaxSendMessageResponse | null> {
    if (!this.isConfigured()) return null;

    const url = new URL(`${this.apiUrl}/messages`);
    url.searchParams.set('user_id', String(userId));

    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`sendMessage to ${userId} failed (${res.status}): ${text}`);
      return null;
    }

    return res.json() as Promise<MaxSendMessageResponse>;
  }

  /**
   * Редактировать сообщение по его ID.
   */
  async editMessage(messageId: string, body: NewMessageBody): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const url = new URL(`${this.apiUrl}/messages/${encodeURIComponent(messageId)}`);

    const res = await fetch(url.toString(), {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`editMessage ${messageId} failed (${res.status}): ${text}`);
      return false;
    }

    return true;
  }

  /**
   * Удалить сообщение по его ID.
   */
  async deleteMessage(messageId: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const res = await fetch(`${this.apiUrl}/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      headers: this.headers(),
    });

    return res.ok;
  }

  // ─── Callbacks ───

  /**
   * Ответить на callback-нажатие кнопки (показать toast-уведомление пользователю).
   * @param callbackId  ID коллбэка из Update
   * @param notification  Текст уведомления (необязательно)
   */
  async answerCallback(callbackId: string, notification?: string): Promise<MaxAnswerCallbackResponse | null> {
    if (!this.isConfigured()) return null;

    const body: Record<string, unknown> = { callback_id: callbackId };
    if (notification) {
      body.notification = notification;
    }

    const res = await fetch(`${this.apiUrl}/answers`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`answerCallback failed (${res.status}): ${text}`);
      return null;
    }

    return res.json() as Promise<MaxAnswerCallbackResponse>;
  }

  // ─── Webhooks ───

  /**
   * Подписать бота на события через Webhook.
   * @param url      HTTPS URL вашего webhook-endpoint
   * @param secret   Секрет для проверки заголовка X-Max-Bot-Api-Secret (необязательно)
   */
  async registerWebhook(url: string, secret?: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const body: Record<string, unknown> = {
      url,
      update_types: [
        'bot_started',
        'bot_stopped',
        'message_created',
        'message_callback',
      ],
    };

    if (secret) {
      body.secret = secret;
    }

    const res = await fetch(`${this.apiUrl}/subscriptions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`registerWebhook failed (${res.status}): ${text}`);
      return false;
    }

    const data = (await res.json()) as { success: boolean; message?: string };
    this.logger.log(`Webhook registered: ${JSON.stringify(data)}`);
    return data.success;
  }

  /**
   * Отписаться от всех Webhook.
   */
  async unregisterWebhook(): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const res = await fetch(`${this.apiUrl}/subscriptions`, {
      method: 'DELETE',
      headers: this.headers(),
    });

    return res.ok;
  }
}
