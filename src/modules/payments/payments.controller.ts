import {
  Controller,
  Post,
  Get,
  Query,
  Body,
  Res,
  Logger,
  HttpStatus,
  Inject,
  forwardRef,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentsService } from './payments.service';
import { FreekassaService } from './freekassa.service';
import { PaymentNotificationService } from './payment-notification.service';
import { SubscriptionsService } from '@modules/subscriptions';
import { UserBotService } from '@modules/bot/services/user-bot.service';
import { ReferralService } from '@modules/referral/referral.service';
import { SubscriptionSource } from '@database/entities';
import { GetPaidSessionsDto } from './dto/get-paid-sessions.dto';
import { GetRandomPaidSessionsDto } from './dto/get-random-paid-sessions.dto';
import { SendTelegramMessageDto } from './dto/send-telegram-message.dto';
import { JwtAuthGuard, Public } from '@modules/auth';

interface FreekassaWebhookBody {
  MERCHANT_ID: string;
  AMOUNT: string;
  intid: string;
  MERCHANT_ORDER_ID: string;
  P_EMAIL?: string;
  P_PHONE?: string;
  CUR_ID?: string;
  SIGN: string;
  payer_account?: string;
  commission?: string;
  [key: string]: string | undefined;
}

@ApiTags('Payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly freekassaService: FreekassaService,
    private readonly notificationService: PaymentNotificationService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(forwardRef(() => UserBotService))
    private readonly userBotService: UserBotService,
    private readonly referralService: ReferralService,
  ) {}

  @Public()
  @Post('webhook')
  @ApiOperation({ summary: 'Webhook FreeKassa', description: 'Серверное уведомление от FreeKassa об успешной оплате.' })
  @ApiResponse({ status: 200, description: 'YES — оплата обработана' })
  @ApiResponse({ status: 400, description: 'Неверная подпись' })
  @ApiResponse({ status: 404, description: 'Сессия платежа не найдена' })
  async handleWebhook(
    @Body() body: FreekassaWebhookBody,
    @Res() res: Response,
  ) {
    const { MERCHANT_ID, AMOUNT, MERCHANT_ORDER_ID, SIGN, intid } = body;

    this.logger.log(`FK webhook body: ${JSON.stringify(body)}`);

    // Отклоняем запросы без orderId и без intid
    if (!MERCHANT_ORDER_ID && !intid) {
      this.logger.warn('FK webhook received with empty MERCHANT_ORDER_ID and intid');
      return res.status(HttpStatus.BAD_REQUEST).send('Missing MERCHANT_ORDER_ID');
    }

    // 1. Верифицируем подпись
    const isValid = this.freekassaService.verifyWebhookSignature(
      MERCHANT_ID,
      AMOUNT,
      MERCHANT_ORDER_ID,
      SIGN,
    );

    if (!isValid) {
      this.logger.error(`Invalid FK signature: orderId=${MERCHANT_ORDER_ID}`);
      return res.status(HttpStatus.BAD_REQUEST).send('Invalid signature');
    }

    // 2. Находим сессию платежа: сначала по MERCHANT_ORDER_ID, затем по intid
    let session = MERCHANT_ORDER_ID
      ? await this.paymentsService.findByInvId(MERCHANT_ORDER_ID)
      : null;

    if (!session && intid) {
      this.logger.warn(`Session not found by MERCHANT_ORDER_ID="${MERCHANT_ORDER_ID}", trying intid="${intid}"`);
      session = await this.paymentsService.findByFkOrderId(intid);
    }

    if (!session) {
      this.logger.error(`Payment session not found: ${MERCHANT_ORDER_ID}`);
      return res.status(HttpStatus.NOT_FOUND).send('Session not found');
    }

    // 3. Идемпотентность
    if (session.status === 'paid') {
      this.logger.log(`Payment already processed: ${MERCHANT_ORDER_ID}`);
      return res.send('YES');
    }

    // 4. Определяем что делать: продлить конкретную, продлить активную, или создать новую
    let subscriptionUrl: string;
    let result: any;
    let subPageUrl: string | null = null;

    // Парсим метаданные плана
    let planMeta: any = {};
    if (session.planMetadata) {
      try {
        planMeta = JSON.parse(session.planMetadata);
      } catch (e) {
        this.logger.warn(`Failed to parse planMetadata for session ${session.id}`);
      }
    }

    const isAntiThrottling = planMeta.planType === 'anti-throttling' || (planMeta.dataLimitGB ?? 0) > 0;

    // ── Покупка слотов устройств ──
    if (planMeta.type === 'device_slots') {
      if (!session.subscriptionId) {
        this.logger.error(`device_slots payment ${session.id} has no subscriptionId`);
        return res.status(HttpStatus.BAD_REQUEST).send('Missing subscriptionId');
      }
      try {
        await this.subscriptionsService.updateHwidDeviceLimit(session.subscriptionId, planMeta.newLimit);
        this.logger.log(
          `Device slots updated for sub ${session.subscriptionId}: newLimit=${planMeta.newLimit}`,
        );
      } catch (error) {
        this.logger.error(`Failed to update hwidDeviceLimit for sub ${session.subscriptionId}:`, error);
      }
      await this.paymentsService.markPaid(session.invId);
      await this.notificationService.notifyDeviceSlotsSuccess(
        session.telegramId,
        planMeta.slotsCount,
        planMeta.newLimit,
      );
      // Канальное уведомление о покупке слотов
      try {
        const bot = this.userBotService.getBot();
        const now = new Date();
        const formattedDate = now.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        const channelMsg = [
          '💻 <b>Покупка слотов устройств!</b>\n',
          `🆔 <b>Telegram ID:</b> <code>${session.telegramId}</code>`,
          `📦 <b>Пакет:</b> ${planMeta.label ?? planMeta.slotsCount + ' слот(ов)'}`,
          `💵 <b>Цена:</b> ${session.amount} ₽`,
          `📅 <b>Дата:</b> ${formattedDate}`,
        ].join('\n');
        await this.userBotService.sendNotificationToChannel(channelMsg, 'HTML');
      } catch (e) {
        this.logger.error('Failed to send device slots channel notification:', e);
      }
      return res.send('YES');
    }

    if (session.subscriptionId) {
      // Mini app: продлеваем конкретную подписку
      const extended = await this.subscriptionsService.extendSubscription(
        session.subscriptionId,
        session.period * 30,
        planMeta.dataLimitGB ?? 0,
      );
      this.logger.log(
        `Extended specific subscription ${session.subscriptionId} for user ${session.telegramId} by ${session.period * 30} days`
      );
      subscriptionUrl = await this.subscriptionsService.getSubscriptionUrl(extended.id);
      subPageUrl = await this.subscriptionsService.getSubPageUrl(extended.id);
      result = { subscriptionUrl };
    } else if (session.forceNewSubscription) {
      // Mini app: создать новую подписку (не продлевать активную)
      result = await this.subscriptionsService.createSubscription({
        telegramId: session.telegramId,
        days: session.period * 30,
        source: SubscriptionSource.BOT,
        dataLimitGB: planMeta.dataLimitGB ?? 0,
        proxiesConfig: planMeta.proxiesConfig,
        inboundsConfig: planMeta.inboundsConfig,
        note: planMeta.subscriptionName || null,
        isAdditional: planMeta.isMain === false,
      });
      subscriptionUrl = result.subscriptionUrl;
      subPageUrl = result.subPageUrl;
      this.logger.log(
        `Created new subscription (${planMeta.planType ?? 'standard'}) for user ${session.telegramId}, ` +
        `dataLimit: ${planMeta.dataLimitGB ?? 0} GB`
      );
    } else {
      // Bot flow: продлить активную подписку того же типа или создать новую
      const isAntiThrottlingBot =
        planMeta.planType === 'anti-throttling' || (planMeta.dataLimitGB ?? 0) > 0;

      const allActives = await this.subscriptionsService.getActiveSubscriptionsByTelegramId(
        session.telegramId,
      );
      const activeSubscription =
        allActives.find((s) => s.isAntiThrottling === isAntiThrottlingBot) ?? null;

      if (activeSubscription) {
        const extended = await this.subscriptionsService.extendSubscription(
          activeSubscription.id,
          session.period * 30,
          planMeta.dataLimitGB ?? 0,
        );
        this.logger.log(
          `Extended subscription ${activeSubscription.id} for user ${session.telegramId} by ${session.period * 30} days`,
        );
        subscriptionUrl = await this.subscriptionsService.getSubscriptionUrl(extended.id);
        subPageUrl = await this.subscriptionsService.getSubPageUrl(extended.id);
        result = { subscriptionUrl };
      } else {
        result = await this.subscriptionsService.createSubscription({
          telegramId: session.telegramId,
          days: session.period * 30,
          source: SubscriptionSource.BOT,
          dataLimitGB: planMeta.dataLimitGB ?? 0,
          proxiesConfig: planMeta.proxiesConfig,
          inboundsConfig: planMeta.inboundsConfig,
          note: planMeta.subscriptionName,
          isAdditional: planMeta.isMain === false,
        });
        subscriptionUrl = result.subscriptionUrl;
        subPageUrl = result.subPageUrl;
        this.logger.log(`Created new subscription for user ${session.telegramId}`);
      }
    }

    // 5. Помечаем платеж как оплаченный
    await this.paymentsService.markPaid(session.invId);

    // 6. Уведомляем пользователя
    await this.notificationService.notifyPaymentSuccess(
      session.telegramId,
      subscriptionUrl,
      session.period,
      isAntiThrottling,
      subPageUrl,
    );

    // 8. Отправляем уведомление в канал о покупке
    try {
      // Получаем информацию о пользователе
      const bot = this.userBotService.getBot();
      let username = 'Unknown';
      let firstName = '';
      
      try {
        const chat = await bot.telegram.getChat(session.telegramId);
        if ('username' in chat && chat.username) {
          username = `@${chat.username}`;
        } else if ('first_name' in chat) {
          firstName = chat.first_name;
          username = firstName;
          if ('last_name' in chat && chat.last_name) {
            username += ` ${chat.last_name}`;
          }
        }
      } catch (error) {
        this.logger.warn(`Could not fetch user info for ${session.telegramId}:`, error);
      }

      const now = new Date();
      const formattedDate = now.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const periodText = session.period === 1 ? '1 месяц' : `${session.period} месяцев`;
      const tariffText = planMeta.label ?? periodText;

      const message = [
        '💰 <b>Новая покупка!</b>\n',
        `👤 <b>Пользователь:</b> ${username}`,
        `🆔 <b>Telegram ID:</b> <code>${session.telegramId}</code>`,
        `📦 <b>Тариф:</b> ${tariffText}`,
        `💵 <b>Цена:</b> ${session.amount} ₽`,
        `📅 <b>Дата:</b> ${formattedDate}`,
      ].join('\n');

      await this.userBotService.sendNotificationToChannel(message, 'HTML');
      this.logger.log(`Purchase notification sent to channel for user ${session.telegramId}`);
    } catch (error) {
      this.logger.error('Failed to send purchase notification to channel:', error);
      // Не прерываем обработку платежа если уведомление не отправилось
    }

    this.logger.log(`Payment processed successfully: invId=${session.invId}, MERCHANT_ORDER_ID=${MERCHANT_ORDER_ID}, intid=${intid}`);

    // 9. Реферальное вознаграждение (только для новых основных подписок, не продлений и не дополнительных)
    if (session.referrerId && !session.subscriptionId && planMeta.isMain !== false) {
      try {
        await this.referralService.rewardReferrer(session.referrerId);
        this.logger.log(`Referral reward issued to ${session.referrerId} for user ${session.telegramId}`);
      } catch (error) {
        this.logger.error('Failed to process referral reward:', error);
      }
    }

    // FreeKassa ожидает ответ YES
    return res.send('YES');
  }

  @Get('paid-sessions')
  @ApiOperation({ summary: 'Получить все оплаченные payment sessions с фильтрацией по датам и пагинацией' })
  @ApiResponse({ status: 200, description: 'Список оплаченных sessions с пагинацией' })
  async getPaidSessions(@Query() dto: GetPaidSessionsDto) {
    const dateFrom = dto.dateFrom ? new Date(dto.dateFrom) : undefined;
    const dateTo = dto.dateTo ? new Date(dto.dateTo) : undefined;
    const page = dto.page || 1;
    const limit = dto.limit || 20;

    const result = await this.paymentsService.getPaidSessions(
      dateFrom,
      dateTo,
      page,
      limit,
    );
    
    return result;
  }

  @Get('paid-sessions/random')
  @ApiOperation({ summary: 'Получить случайную выборку из оплаченных payment sessions' })
  @ApiResponse({ status: 200, description: 'Случайная выборка оплаченных sessions' })
  async getRandomPaidSessions(@Query() dto: GetRandomPaidSessionsDto) {
    const dateFrom = dto.dateFrom ? new Date(dto.dateFrom) : undefined;
    const dateTo = dto.dateTo ? new Date(dto.dateTo) : undefined;

    const sessions = await this.paymentsService.getRandomPaidSessions(
      dto.count,
      dateFrom,
      dateTo,
    );
    return sessions;
  }

  @Get('export-csv')
  @ApiOperation({ summary: 'Экспорт оплаченных payment sessions в CSV' })
  @ApiResponse({ status: 200, description: 'CSV файл' })
  async exportPaidSessionsCsv(
    @Query() dto: GetPaidSessionsDto,
    @Res() res: Response,
  ) {
    const dateFrom = dto.dateFrom ? new Date(dto.dateFrom) : undefined;
    const dateTo = dto.dateTo ? new Date(dto.dateTo) : undefined;

    const sessions = await this.paymentsService.getAllPaidSessions(dateFrom, dateTo);

    const fmtDate = (d: any) => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const statusLabel: Record<string, string> = {
      paid: 'Оплачено', pending: 'Ожидание', failed: 'Ошибка', expired: 'Истёк',
    };

    const header = 'ID,invId,Тг ID,Статус,Дата платежа\n';
    const rows = sessions.map((s) =>
      [
        s.id,
        s.invId,
        s.telegramId,
        statusLabel[s.status] ?? s.status,
        fmtDate(s.createdAt),
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(','),
    );

    const csv = header + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payment-sessions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send('\uFEFF' + csv);
  }

  @Post('send-telegram-message')
  @ApiOperation({ summary: 'Отправить сообщение пользователю по Telegram ID' })
  @ApiResponse({ status: 200, description: 'Сообщение отправлено' })
  @ApiResponse({ status: 400, description: 'Ошибка отправки сообщения' })
  async sendTelegramMessage(@Body() dto: SendTelegramMessageDto) {
    try {
      const result = await this.userBotService.sendMessage(
        dto.message,
        dto.telegramId,
      );

      if (result.sent > 0) {
        this.logger.log(`Telegram message sent to ${dto.telegramId}`);
        return {
          success: true,
          message: 'Сообщение успешно отправлено',
        };
      } else {
        this.logger.error(`Failed to send message to ${dto.telegramId}`);
        return {
          success: false,
          message: 'Не удалось отправить сообщение',
        };
      }
    } catch (error) {
      this.logger.error(`Error sending telegram message to ${dto.telegramId}:`, error);
      return {
        success: false,
        message: 'Ошибка при отправке сообщения',
      };
    }
  }
}

