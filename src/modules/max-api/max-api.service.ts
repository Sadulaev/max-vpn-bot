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

  // ─── Upload ───

  /**
   * Загрузить изображение в MAX и получить токен для использования в сообщениях.
   * Процесс: POST /uploads?type=image → URL → POST file → { token }
   *
   * @param buffer    Буфер файла
   * @param filename  Имя файла (используется как MIME hint)
   * @returns         Токен изображения или null при ошибке
   */
  async uploadImage(buffer: Buffer, filename = 'image.png'): Promise<string | null> {
    if (!this.isConfigured()) return null;

    // Шаг 1: получить URL для загрузки
    const urlRes = await fetch(`${this.apiUrl}/uploads?type=image`, {
      method: 'POST',
      headers: { Authorization: this.botToken },
    });

    if (!urlRes.ok) {
      const text = await urlRes.text().catch(() => '');
      this.logger.error(`getUploadUrl(image) failed (${urlRes.status}): ${text}`);
      return null;
    }

    const { url } = (await urlRes.json()) as { url: string };

    // Шаг 2: загрузить файл multipart/form-data
    const mimeType = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
    const formData = new FormData();
    // Buffer → Uint8Array, чтобы избежать несовместимости типов с BlobPart
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append('data', blob, filename);

    const uploadRes = await fetch(url, {
      method: 'POST',
      // Не устанавливаем Content-Type — fetch выставит его автоматически с boundary
      body: formData,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      this.logger.error(`uploadImage failed (${uploadRes.status}): ${text}`);
      return null;
    }

    const data = (await uploadRes.json()) as {
      token?: string;
      photos?: Record<string, { token: string }>;
    };

    let token: string | null = data.token ?? null;

    // MAX API returns { photos: { [key]: { token } } } for image uploads
    if (!token && data.photos) {
      const firstPhoto = Object.values(data.photos)[0];
      token = firstPhoto?.token ?? null;
    }

    if (token) {
      this.logger.log(`Image uploaded successfully, token length=${token.length}`);
    } else {
      this.logger.warn(`Image upload succeeded but no token in response: ${JSON.stringify(data)}`);
    }

    return token;
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
