import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotState } from '@database/entities';
import { MaxApiService } from '@modules/max-api';

export const MAX_BOT_TOKEN_KEY = 'max_bot_token';
export const TELEGRAM_BOT_TOKEN_KEY = 'telegram_bot_token';

export function maskSecret(value: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  if (v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

@Injectable()
export class BotTokensService implements OnModuleInit {
  private readonly logger = new Logger(BotTokensService.name);
  private telegramBotToken = '';
  private maxBotUsername = '';

  constructor(
    private readonly configService: ConfigService,
    private readonly maxApi: MaxApiService,
    @InjectRepository(BotState)
    private readonly botStateRepository: Repository<BotState>,
  ) {}

  async onModuleInit() {
    const [maxFromDb, tgFromDb] = await Promise.all([
      this.getStoredValue(MAX_BOT_TOKEN_KEY),
      this.getStoredValue(TELEGRAM_BOT_TOKEN_KEY),
    ]);

    const maxToken = (
      maxFromDb ||
      this.configService.get<string>('max.botToken', '') ||
      process.env.MAX_BOT_TOKEN ||
      ''
    ).trim();
    if (maxToken && maxToken !== this.maxApi.getBotToken()) {
      this.maxApi.setBotToken(maxToken);
    }
    if (maxToken) {
      this.logger.log(
        maxFromDb
          ? 'MAX bot token loaded from settings (DB)'
          : 'MAX bot token loaded from env',
      );
    }

    this.telegramBotToken = (
      tgFromDb ||
      this.configService.get<string>('telegram.botToken', '') ||
      process.env.TELEGRAM_BOT_TOKEN ||
      ''
    ).trim();
    if (this.telegramBotToken) {
      this.logger.log(
        tgFromDb
          ? 'Telegram bot token loaded from settings (DB)'
          : 'Telegram bot token loaded from env',
      );
    }

    await this.refreshMaxIdentity().catch(() => undefined);
  }

  getTelegramBotToken(): string {
    return this.telegramBotToken;
  }

  getMaxBotUsername(): string {
    return this.maxBotUsername;
  }

  getTokensPublicInfo() {
    return {
      maxBotTokenMasked: maskSecret(this.maxApi.getBotToken()),
      telegramBotTokenMasked: maskSecret(this.telegramBotToken),
      maxBotConfigured: this.maxApi.isConfigured(),
      telegramBotConfigured: !!this.telegramBotToken,
      maxBotUsername: this.maxBotUsername || null,
    };
  }

  async applyMaxBotToken(token: string): Promise<void> {
    const next = token.trim();
    if (!next) {
      throw new BadRequestException('MAX bot token is empty');
    }

    const info = await this.validateMaxToken(next);
    if (!info) {
      throw new BadRequestException('Неверный MAX_BOT_TOKEN — getMe не прошёл');
    }

    const previous = this.maxApi.getBotToken();
    if (previous && previous !== next) {
      try {
        await this.maxApi.unregisterWebhook();
      } catch (err) {
        this.logger.warn(
          `unregisterWebhook before token swap failed: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    this.maxApi.setBotToken(next);
    await this.setStoredValue(MAX_BOT_TOKEN_KEY, next);
    this.maxBotUsername = info.username || '';
    await this.registerWebhook();
    this.logger.log(`MAX bot token applied, bot=@${this.maxBotUsername || info.user_id}`);
  }

  async applyTelegramBotToken(token: string): Promise<void> {
    const next = token.trim();
    if (!next) {
      throw new BadRequestException('Telegram bot token is empty');
    }

    const ok = await this.validateTelegramToken(next);
    if (!ok) {
      throw new BadRequestException('Неверный TELEGRAM_BOT_TOKEN — getMe не прошёл');
    }

    this.telegramBotToken = next;
    await this.setStoredValue(TELEGRAM_BOT_TOKEN_KEY, next);
    this.logger.log('Telegram bot token applied');
  }

  async registerWebhook(): Promise<boolean> {
    const baseUrl = this.configService.get<string>('app.baseUrl', '');
    const webhookSecret = this.configService.get<string>('max.webhookSecret', '');

    if (!this.maxApi.isConfigured()) {
      this.logger.warn('MaxApiService not configured — skipping webhook registration');
      return false;
    }
    if (!baseUrl) {
      this.logger.warn('BASE_URL not set — skipping webhook registration');
      return false;
    }

    const webhookUrl = `${baseUrl.replace(/\/$/, '')}/max/webhook`;
    this.logger.log(`Registering MAX webhook: ${webhookUrl}`);
    try {
      const ok = await this.maxApi.registerWebhook(webhookUrl, webhookSecret || undefined);
      if (ok) {
        this.logger.log('MAX webhook registered successfully');
      } else {
        this.logger.warn('MAX webhook registration returned failure (check URL/token)');
      }
      return ok;
    } catch (err) {
      this.logger.error(
        `MAX webhook registration threw: ${(err as Error)?.message ?? err}`,
      );
      return false;
    }
  }

  private async refreshMaxIdentity(): Promise<void> {
    if (!this.maxApi.isConfigured()) {
      this.maxBotUsername = '';
      return;
    }
    const info = await this.maxApi.getMe();
    this.maxBotUsername = info?.username || '';
  }

  private async validateMaxToken(
    token: string,
  ): Promise<{ user_id: number; username?: string; name?: string } | null> {
    const apiUrl = this.maxApi.getApiUrl() || 'https://platform-api2.max.ru';
    try {
      const res = await fetch(`${apiUrl}/me`, {
        method: 'GET',
        headers: { Authorization: token },
      });
      if (!res.ok) return null;
      return (await res.json()) as { user_id: number; username?: string; name?: string };
    } catch (err) {
      this.logger.error(`validateMaxToken failed: ${(err as Error)?.message ?? err}`);
      return null;
    }
  }

  private async validateTelegramToken(token: string): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      if (!res.ok) return false;
      const data = (await res.json()) as { ok?: boolean };
      return !!data.ok;
    } catch (err) {
      this.logger.error(`validateTelegramToken failed: ${(err as Error)?.message ?? err}`);
      return false;
    }
  }

  private async getStoredValue(key: string): Promise<string | null> {
    const row = await this.botStateRepository.findOne({ where: { name: key } });
    const value = row?.value?.trim();
    return value ? value : null;
  }

  private async setStoredValue(key: string, value: string): Promise<void> {
    let row = await this.botStateRepository.findOne({ where: { name: key } });
    if (!row) {
      row = this.botStateRepository.create({
        name: key,
        enabled: true,
        value,
      });
    } else {
      row.value = value;
    }
    await this.botStateRepository.save(row);
  }
}
