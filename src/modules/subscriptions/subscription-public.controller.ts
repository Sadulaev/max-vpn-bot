import {
  Controller,
  Get,
  Param,
  Res,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { SubscriptionsService } from './subscriptions.service';

// Публичный контроллер для v2ray клиентов (БЕЗ префикса /api)
@ApiTags('Public Subscription')
@Controller('sub')
export class SubscriptionPublicController {
  private readonly logger = new Logger(SubscriptionPublicController.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  /**
   * Редирект на Remnawave subscription URL.
   * Принимает UUID подписки (с дефисами), username (без дефисов) или shortUuid.
   */
  @Get(':identifier')
  @ApiOperation({
    summary: 'Редирект на Remnawave subscription URL',
    description:
      'Принимает UUID подписки, username или shortUuid, находит subscriptionUrl и делает 301-редирект на Remnawave.',
  })
  @ApiParam({ name: 'identifier', description: 'UUID подписки, username или shortUuid' })
  @ApiResponse({ status: 301, description: 'Редирект на Remnawave subscription URL' })
  @ApiResponse({ status: 404, description: 'Подписка не найдена' })
  async redirect(@Param('identifier') identifier: string, @Res() res: Response) {
    try {
      identifier = identifier.trim();

      // Пробуем найти по shortUuid
      let subscription = await this.subscriptionsService.findByShortUuid(identifier);

      if (!subscription) {
        // Пробуем как UUID (с дефисами) или username (без дефисов)
        const username = identifier.includes('-')
          ? identifier.replace(/-/g, '')
          : identifier;

        subscription = await this.subscriptionsService.findByUsername(username);
      }

      if (!subscription) {
        return res.status(HttpStatus.NOT_FOUND).send('Subscription not found');
      }

      const subscriptionUrl =
        await this.subscriptionsService.getSubscriptionUrl(subscription.id);

      return res.redirect(301, subscriptionUrl);
    } catch (error: any) {
      this.logger.error(`Error redirecting subscription ${identifier}:`, error);
      const status = error?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      return res.status(status).send(error?.message ?? 'Internal server error');
    }
  }
}
