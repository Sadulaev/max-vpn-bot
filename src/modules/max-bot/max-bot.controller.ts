import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MaxBotService } from './max-bot.service';
import type { MaxUpdate } from '@modules/max-api';

@Controller('max')
export class MaxBotController {
  private readonly logger = new Logger(MaxBotController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly botService: MaxBotService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('max.webhookSecret', '');
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() update: MaxUpdate,
    @Headers('x-max-bot-api-secret') secret: string,
  ): Promise<void> {
    // Проверяем секрет, если он настроен
    if (this.webhookSecret && secret !== this.webhookSecret) {
      this.logger.warn('Invalid webhook secret received, ignoring update');
      return;
    }

    this.logger.debug(`Incoming update: ${update.update_type}`);

    // Обрабатываем асинхронно, но отвечаем 200 OK сразу
    this.botService.handleUpdate(update).catch((err: unknown) => {
      this.logger.error(`Unhandled bot error: ${(err as Error)?.message}`);
    });
  }
}
