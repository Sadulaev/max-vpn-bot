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
  chatId?: string;
};

type SendPhotoOptions = SendMessageOptions & {
  caption?: string;
};

@Injectable()
export class MaxApiService {
  private readonly logger = new Logger(MaxApiService.name);

  /**
   * Cache of uploaded photo tokens keyed by local file path.
   * MAX photo tokens are persistent so we can reuse them across sessions.
   */
  private readonly photoTokenCache = new Map<string, string>();

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
    const recipient = this.buildRecipient(userId, options.chatId);

    return this.sendRawMessage(
      {
        ...recipient,
        text,
        format: this.mapFormat(options.parse_mode),
        link_preview: options.disable_web_page_preview === true ? false : undefined,
        attachments: this.buildKeyboardAttachments(options.reply_markup),
      },
      'sendMessage',
    );
  }

  /**
   * Sends a photo message. The photo is uploaded to MAX servers on first use and
   * the resulting token is cached so subsequent calls skip the upload step.
   */
  async sendPhoto(
    userId: string,
    photo: { source: string | Buffer } | Buffer | string,
    options: SendPhotoOptions = {},
  ): Promise<any> {
    const source = this.extractPhotoSource(photo);
    const cacheKey = typeof source === 'string' ? source : null;

    let token: string;

    if (cacheKey && this.photoTokenCache.has(cacheKey)) {
      token = this.photoTokenCache.get(cacheKey)!;
      this.logger.debug(`Reusing cached photo token for ${cacheKey}`);
    } else {
      const fileName = typeof source === 'string' ? basename(source) : 'photo.jpg';
      const buffer = typeof source === 'string' ? await readFile(source) : source;
      token = await this.uploadPhoto(buffer, fileName);

      if (cacheKey) {
        this.photoTokenCache.set(cacheKey, token);
        this.logger.debug(`Cached photo token for ${cacheKey}`);
      }
    }

    const attachments: any[] = [
      { type: 'image', payload: { token } },
      ...this.buildKeyboardAttachments(options.reply_markup),
    ];

    const recipient = this.buildRecipient(userId, options.chatId);

    return this.sendRawMessage(
      {
        ...recipient,
        text: options.caption ?? '',
        format: this.mapFormat(options.parse_mode),
        attachments,
      },
      'sendPhoto',
    );
  }

  /**
   * Invalidates a cached photo token (e.g. if the token has expired).
   */
  invalidatePhotoCache(filePath?: string): void {
    if (filePath) {
      this.photoTokenCache.delete(filePath);
    } else {
      this.photoTokenCache.clear();
    }
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

  // ─── Upload ───────────────────────────────────────────────────────────────

  /**
   * Uploads a photo buffer to MAX servers.
   *
   * MAX photo upload flow:
   *   1. POST /uploads?type=photo  → { url: "https://upload.max.ru/..." }
   *   2. POST {url} (multipart, field "data")  → { photos: { "0": { token: "...", url: "..." } } }
   *   3. Use token in message attachment: { type: "photo", payload: { token } }
   */
  private async uploadPhoto(buffer: Buffer, fileName: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('MAX bot token is not configured');
    }

    // Step 1 – request upload URL
    const initRes = await fetch(`${this.getApiUrl()}/uploads?type=photo`, {
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (!initRes.ok) {
      const body = await initRes.text().catch(() => '');
      throw new Error(`MAX upload init failed (${initRes.status}): ${body}`);
    }

    const initData = await initRes.json();
    this.logger.debug(`Upload init response: ${JSON.stringify(initData)}`);

    const uploadUrl: string | undefined = initData?.url;
    if (!uploadUrl) {
      throw new Error(`MAX upload init: "url" missing in response: ${JSON.stringify(initData)}`);
    }

    // Step 2 – upload file to the provided URL
    const form = new FormData();
    form.append('data', new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }), fileName);

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      body: form,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text().catch(() => '');
      throw new Error(`MAX photo upload failed (${uploadRes.status}): ${body}`);
    }

    const uploadData = await uploadRes.json();
    this.logger.debug(`Upload result: ${JSON.stringify(uploadData)}`);

    // Step 3 – extract token from upload response
    return this.extractUploadToken(uploadData);
  }

  /**
   * Parses the upload token from various MAX API response formats.
   *
   * Known formats:
   *   { photos: { "0": { token: "...", url: "..." } } }
   *   { token: "..." }
   *   [ { token: "..." } ]
   */
  private extractUploadToken(data: any): string {
    // Format: { photos: { "<key>": { token: "..." } } }
    if (data?.photos && typeof data.photos === 'object') {
      const firstKey = Object.keys(data.photos)[0];
      const token: string | undefined = data.photos[firstKey]?.token;
      if (token) {
        return token;
      }
    }

    // Format: { token: "..." }
    if (data?.token) {
      return data.token;
    }

    // Format: [{ token: "..." }]
    if (Array.isArray(data) && data[0]?.token) {
      return data[0].token;
    }

    throw new Error(`MAX photo upload: unexpected response format: ${JSON.stringify(data)}`);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildRecipient(userId: string, chatId?: string): Record<string, number> {
    if (chatId) {
      return { chat_id: Number(chatId) };
    }
    return { user_id: Number(userId) };
  }

  private getApiUrl(): string {
    return (this.configService.get<string>('max.apiUrl') || 'https://botapi.max.ru').replace(/\/+$/, '');
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
    if (parseMode === 'HTML') return 'html';
    if (parseMode === 'Markdown') return 'markdown';
    return undefined;
  }

  /**
   * Converts Telegram-style `reply_markup.inline_keyboard` to MAX inline_keyboard attachment.
   */
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
                return { type: 'link', text: button.text, url: button.url };
              }
              return { type: 'callback', text: button.text, payload: button.callback_data || '' };
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
}
