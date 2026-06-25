import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { basename } from 'path';

type TelegramLikeButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

type TelegramLikeReplyMarkup = {
  inline_keyboard?: TelegramLikeButton[][];
};

type SendMessageOptions = {
  parse_mode?: 'HTML' | 'Markdown';
  reply_markup?: TelegramLikeReplyMarkup;
  disable_web_page_preview?: boolean;
};

type SendPhotoOptions = SendMessageOptions & {
  caption?: string;
};

@Injectable()
export class MaxApiService {
  private readonly logger = new Logger(MaxApiService.name);

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return !!this.configService.get<string>('max.botToken');
  }

  async getMe(): Promise<any | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const response = await fetch(`${this.getApiUrl()}/me`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`MAX getMe failed (${response.status}): ${text}`);
    }

    return response.json();
  }

  async ensureWebhook(): Promise<void> {
    if (!this.isConfigured()) {
      return;
    }

    const baseUrl = (this.configService.get<string>('app.baseUrl') ?? '').replace(/\/+$/, '');
    if (!baseUrl.startsWith('https://')) {
      this.logger.warn('MAX webhook registration skipped: BASE_URL must be https');
      return;
    }

    const webhookUrl = `${baseUrl}/api/max-bot/webhook`;
    const secret = this.configService.get<string>('max.webhookSecret') || undefined;

    const response = await fetch(`${this.getApiUrl()}/subscriptions`, {
      method: 'POST',
      headers: this.getJsonHeaders(),
      body: JSON.stringify({
        url: webhookUrl,
        secret,
        update_types: ['message_created', 'message_callback', 'bot_started'],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`MAX webhook registration failed (${response.status}): ${text}`);
      return;
    }

    this.logger.log(`MAX webhook registered: ${webhookUrl}`);
  }

  async sendMessage(userId: string, text: string, options: SendMessageOptions = {}): Promise<any> {
    return this.sendRawMessage(
      {
        user_id: Number(userId),
        text,
        format: this.mapFormat(options.parse_mode),
        link_preview: options.disable_web_page_preview === true ? false : undefined,
        attachments: this.buildKeyboardAttachments(options.reply_markup),
      },
      'sendMessage',
    );
  }

  async sendPhoto(
    userId: string,
    photo: { source: string | Buffer } | Buffer | string,
    options: SendPhotoOptions = {},
  ): Promise<any> {
    const source = this.extractPhotoSource(photo);
    const fileName = typeof source === 'string' ? basename(source) : 'image.jpg';
    const buffer = typeof source === 'string' ? await readFile(source) : source;
    const token = await this.uploadBuffer(buffer, fileName, 'image/jpeg', 'image');

    const attachments = [
      {
        type: 'image',
        payload: { token },
      },
      ...this.buildKeyboardAttachments(options.reply_markup),
    ];

    return this.sendRawMessage(
      {
        user_id: Number(userId),
        text: options.caption ?? '',
        format: this.mapFormat(options.parse_mode),
        link_preview: options.disable_web_page_preview === true ? false : undefined,
        attachments,
      },
      'sendPhoto',
    );
  }

  async answerCallback(callbackId: string, notification?: string): Promise<void> {
    if (!this.isConfigured() || !callbackId) {
      return;
    }

    const response = await fetch(`${this.getApiUrl()}/answers`, {
      method: 'POST',
      headers: this.getJsonHeaders(),
      body: JSON.stringify({
        callback_id: callbackId,
        notification,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`MAX answerCallback failed (${response.status}): ${text}`);
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    if (!this.isConfigured() || !messageId) {
      return;
    }

    const response = await fetch(`${this.getApiUrl()}/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok && response.status !== 404 && response.status !== 405) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`MAX deleteMessage failed (${response.status}): ${text}`);
    }
  }

  private getApiUrl(): string {
    return (this.configService.get<string>('max.apiUrl') || 'https://platform-api2.max.ru').replace(/\/+$/, '');
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: this.configService.get<string>('max.botToken') || '',
    };
  }

  private getJsonHeaders(): Record<string, string> {
    return {
      ...this.getHeaders(),
      'Content-Type': 'application/json',
    };
  }

  private mapFormat(parseMode?: 'HTML' | 'Markdown'): 'html' | 'markdown' | undefined {
    if (parseMode === 'HTML') {
      return 'html';
    }
    if (parseMode === 'Markdown') {
      return 'markdown';
    }
    return undefined;
  }

  private buildKeyboardAttachments(replyMarkup?: TelegramLikeReplyMarkup): any[] {
    const keyboard = replyMarkup?.inline_keyboard;
    if (!keyboard || keyboard.length === 0) {
      return [];
    }

    return [
      {
        type: 'inline_keyboard',
        payload: {
          buttons: keyboard.map((row) =>
            row.map((button) => {
              if (button.url) {
                return {
                  type: 'link',
                  text: button.text,
                  url: button.url,
                };
              }

              return {
                type: 'callback',
                text: button.text,
                payload: button.callback_data || '',
              };
            }),
          ),
        },
      },
    ];
  }

  private async sendRawMessage(payload: Record<string, unknown>, action: string): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('MAX bot token is not configured');
    }

    const response = await fetch(`${this.getApiUrl()}/messages`, {
      method: 'POST',
      headers: this.getJsonHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`MAX ${action} failed (${response.status}): ${text}`);
    }

    return response.json().catch(() => null);
  }

  private extractPhotoSource(photo: { source: string | Buffer } | Buffer | string): string | Buffer {
    if (typeof photo === 'string' || Buffer.isBuffer(photo)) {
      return photo;
    }

    return photo.source;
  }

  private async uploadBuffer(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    uploadType: 'image' | 'video' | 'audio' | 'file',
  ): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('MAX bot token is not configured');
    }

    const initResponse = await fetch(`${this.getApiUrl()}/uploads?type=${uploadType}`, {
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (!initResponse.ok) {
      const text = await initResponse.text().catch(() => '');
      throw new Error(`MAX upload init failed (${initResponse.status}): ${text}`);
    }

    const initPayload = await initResponse.json();
    const uploadUrl = initPayload?.url;
    const token = initPayload?.token;

    if (!uploadUrl || !token) {
      throw new Error('MAX upload init returned invalid payload');
    }

    const formData = new FormData();
    const bytes = new Uint8Array(buffer);
    formData.append('data', new Blob([bytes], { type: mimeType }), fileName);

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const text = await uploadResponse.text().catch(() => '');
      throw new Error(`MAX upload failed (${uploadResponse.status}): ${text}`);
    }

    return token;
  }
}