import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post } from '@nestjs/common';
import { Public } from '@modules/auth';
import { MaxBotService } from './max-bot.service';

@Controller('max-bot')
export class MaxBotController {
  private readonly logger = new Logger(MaxBotController.name);

  constructor(private readonly maxBotService: MaxBotService) {}

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Headers('x-max-bot-api-secret') secretHeader?: string,
  ) {
    const expectedSecret = process.env.MAX_WEBHOOK_SECRET || '';
    if (expectedSecret && secretHeader !== expectedSecret) {
      this.logger.warn('Rejected MAX webhook with invalid secret');
      return { ok: false };
    }

    await this.maxBotService.handleUpdate(body);
    return { ok: true };
  }
}