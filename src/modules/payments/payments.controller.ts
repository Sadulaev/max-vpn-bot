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
import { ReferralService } from '@modules/referral/referral.service';
import { SubscriptionSource } from '@database/entities';
import { GetPaidSessionsDto } from './dto/get-paid-sessions.dto';
import { GetRandomPaidSessionsDto } from './dto/get-random-paid-sessions.dto';
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
        session.maxId,
        planMeta.slotsCount,
        planMeta.newLimit,
      );
      // Канальное уведомление о покупке слотов
      const now = new Date();
      const formattedDate = now.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const slotMessage = [
        '🖥 <b>Куплены слоты устройств!</b>\n',
        `🆔 <b>Max ID:</b> <code>${session.maxId}</code>`,
        `📦 <b>Слотов:</b> ${planMeta.slotsCount} (новый лимит: ${planMeta.newLimit})`,
        `💵 <b>Цена:</b> ${session.amount} ₽`,
        `📅 <b>Дата:</b> ${formattedDate}`,
      ].join('\n');
      await this.notificationService.sendChannelNotification(slotMessage);
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
        `Extended specific subscription ${session.subscriptionId} for user ${session.maxId} by ${session.period * 30} days`
      );
      subscriptionUrl = await this.subscriptionsService.getSubscriptionUrl(extended.id);
      subPageUrl = await this.subscriptionsService.getSubPageUrl(extended.id);
      result = { subscriptionUrl };
    } else if (session.forceNewSubscription) {
      // Mini app: создать новую подписку (не продлевать активную)
      result = await this.subscriptionsService.createSubscription({
        maxId: session.maxId,
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
        `Created new subscription (${planMeta.planType ?? 'standard'}) for user ${session.maxId}, ` +
        `dataLimit: ${planMeta.dataLimitGB ?? 0} GB`
      );
    } else {
      // Bot: создать или продлить подписку для пользователя
      result = await this.subscriptionsService.createSubscription({
        maxId: session.maxId,
        days: (planMeta.days as number) ?? session.period * 30,
        source: SubscriptionSource.BOT,
        dataLimitGB: (planMeta.dataLimitGB as number) ?? 0,
        referrerId: session.referrerId ?? undefined,
        note: (planMeta.planLabel as string) ?? null,
      });
      subscriptionUrl = result.subscriptionUrl ?? '';
      subPageUrl = result.subPageUrl ?? null;
      this.logger.log(
        `Bot subscription created/extended for user ${session.maxId}, plan: ${planMeta.planLabel ?? 'unknown'}`,
      );
    }

    // 5. Помечаем платеж как оплаченный
    await this.paymentsService.markPaid(session.invId);

    // 6. Уведомляем пользователя
    await this.notificationService.notifyPaymentSuccess(
      session.maxId,
      subscriptionUrl,
      session.period,
      subPageUrl,
    );

    // 8. Отправляем уведомление в канал о покупке
    try {
      // Получаем информацию о пользователе
      // TODO: добавить получение username
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
        `👤 <b>Пользователь:</b> ${session.maxId ?? 'неизвестно'}`,
        `🆔 <b>Max ID:</b> <code>${session.maxId}</code>`,
        `📦 <b>Тариф:</b> ${tariffText}`,
        `💵 <b>Цена:</b> ${session.amount} ₽`,
        `📅 <b>Дата:</b> ${formattedDate}`,
      ].join('\n');

      await this.notificationService.sendChannelNotification(message);
      this.logger.log(`Purchase notification sent to channel for user ${session.maxId}`);
    } catch (error) {
      this.logger.error('Failed to send purchase notification to channel:', error);
      // Не прерываем обработку платежа если уведомление не отправилось
    }

    this.logger.log(`Payment processed successfully: invId=${session.invId}, MERCHANT_ORDER_ID=${MERCHANT_ORDER_ID}, intid=${intid}`);

    // 9. Реферальное вознаграждение (только для новых основных подписок, не продлений и не дополнительных)
    if (session.referrerId && !session.subscriptionId && planMeta.isMain !== false) {
      try {
        await this.referralService.rewardReferrer(session.referrerId);
        this.logger.log(`Referral reward issued to ${session.referrerId} for user ${session.maxId}`);
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
        s.maxId ,
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

  @Post('send-message')
  @ApiOperation({ summary: 'Отправить сообщение пользователю в MAX' })
  @ApiResponse({ status: 200, description: 'Сообщение отправлено' })
  @ApiResponse({ status: 400, description: 'Ошибка отправки сообщения' })
  async sendMaxMessage(@Body() dto: any) {
    //TODO: реализовать отправку сообщения пользователю через MAX API
  }
}

