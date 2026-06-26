import { Injectable, Logger, Inject, forwardRef } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Markup, Telegraf } from "telegraf";
import { SubscriptionsService } from "@modules/subscriptions";
import { RemnawaveApiService } from "@modules/remnawave-api";
import type { RemnawaveUserResponse, RemnawaveHwidDevice } from "@modules/remnawave-api";
import { PaymentsService, FreekassaService } from "@modules/payments";
import { Subscription, SubscriptionSource, BotState, Plan, DeviceSlotPlan } from "@database/entities";
import { BotPagesService } from '@modules/bot-pages';
import { MaxApiService } from '@modules/max-api';
import { BotCallbacks } from "../constants/callbacks";
import { BotMessages } from "../constants/messages";
import { MessageContext, CallbackContext } from "../types/context";
import { formatDate } from "../utils/format-date";

@Injectable()
export class UserBotService {
  private readonly logger = new Logger(UserBotService.name);
  private readonly bot: Telegraf;
  /** Временный кеш устройств: ключ = `${telegramId}_${subId}`, значение = массив HWID-устройств */
  private readonly deviceCache = new Map<string, RemnawaveHwidDevice[]>();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
    private readonly remnawaveApiService: RemnawaveApiService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly paymentsService: PaymentsService,
    @Inject(forwardRef(() => FreekassaService))
    private readonly freekassaService: FreekassaService,
    @InjectRepository(BotState)
    private readonly botStateRepository: Repository<BotState>,
    @InjectRepository(Plan)
    private readonly planRepository: Repository<Plan>,
    @InjectRepository(DeviceSlotPlan)
    private readonly deviceSlotPlanRepository: Repository<DeviceSlotPlan>,
    private readonly botPagesService: BotPagesService,
    private readonly maxApiService: MaxApiService,
  ) {
    const telegram = this.configService.get('telegram');
    const token = telegram?.userBotToken;
    if (token) {
      this.bot = new Telegraf(token);
    } else {
      this.logger.warn('User bot token not configured');
      this.bot = null as any;
    }
  }

  /**
   * Обработка команды /start
   */
  async handleStart(ctx: MessageContext): Promise<void> {
    const telegramId = ctx.message.from?.id.toString();

    if (!telegramId) {
      await ctx.reply("Ошибка: не удалось получить ваш Telegram ID");
      return;
    }

    // Парсим реферальный параметр (/start <referrerId>)
    const startPayload = (ctx.message as any).text?.split(' ')[1] as string | undefined;
    if (startPayload && startPayload !== telegramId) {
      ctx.session.referrerId = startPayload;
      this.logger.log(`User ${telegramId} was referred by ${startPayload}`);
    }

    const allSubscriptions = await this.subscriptionsService.getAllSubscriptionsByTelegramId(telegramId);

    if (allSubscriptions.length === 0) {
      await this.createTrialAndShowMenu(ctx, telegramId);
    } else {
      await this.sendMainMenu(ctx);
    }
  }

  /**
   * Создать пробные подписки и сразу показать главное меню
   */
  private async createTrialAndShowMenu(
    ctx: MessageContext,
    telegramId: string,
  ): Promise<void> {
    try {
      const trialSub = await this.subscriptionsService.createSubscription({
        telegramId,
        days: 1,
        source: SubscriptionSource.BOT,
        dataLimitGB: 0,
        note: 'VPN HIT Trial 24h',
      });

      this.logger.log(`Created 24h trial subscription for user ${telegramId}: ${trialSub.subscriptionId}`);

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);

      const endDateText = endDate.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      await ctx.reply(
        `🎉 <b>VPN HIT активирован</b>\n\n` +
        `Вы получили <b>пробный доступ на 24 часа</b>.\n` +
        `⏳ До: <b>${endDateText}</b>\n\n` +
        (trialSub.subPageUrl ? `📱 <a href="${trialSub.subPageUrl}">Открыть страницу подписки</a>\n\n` : '') +
        `Дальше всё управление доступом будет в разделе «Моя подписка».`,
        { parse_mode: 'HTML' },
      );

      await this.sendMainMenu(ctx);
    } catch (error) {
      this.logger.error(`Failed to create trial subscription for ${telegramId}:`, error);
      await ctx.reply('⚠️ Произошла ошибка при создании пробной подписки. Обратитесь в поддержку.');
    }
  }

  /**
   * Отправить главное меню
   */
  async sendMainMenu(ctx: MessageContext | CallbackContext): Promise<void> {
    const telegramId = 'from' in ctx ? ctx.from?.id.toString() : (ctx as CallbackContext).callbackQuery?.from?.id.toString();
    const userId = telegramId || 'N/A';
    const balance = '0 ₽';
    
    const hardcodedButtons = [
      [{ text: '— Приобрести подписку', callback_data: BotCallbacks.BuySubscription }],
      [{ text: '📖 Инструкция установки', callback_data: BotCallbacks.Instructions }],
      [
        { text: '🔑 Мои ключи', callback_data: BotCallbacks.MySubscription },
        { text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' },
      ],
      [{ text: '👥 Реферальная система', callback_data: BotCallbacks.Referral }],
      [{ text: '🎁 Подарить другу', callback_data: BotCallbacks.BuyAdditional }],
      [{ text: '📢 Наш канал', url: 'https://t.me/vpn_hit_channel' }],
    ];

    const welcomeText = BotMessages.welcome
      .replace('{{userId}}', userId)
      .replace('{{balance}}', balance);

    const [caption, dynamicButtons] = await Promise.all([
      this.getPageText('menu', welcomeText),
      this.getPageButtons('menu'),
    ]);

    const buttons = Markup.inlineKeyboard((dynamicButtons ?? hardcodedButtons) as any);

    try {
      await ctx.replyWithPhoto(
        { source: './assets/max-default.png' },
        {
          caption,
          parse_mode: 'HTML',
          reply_markup: buttons.reply_markup,
        },
      );
    } catch (photoError) {
      this.logger.warn(
        `Failed to send photo in main menu, falling back to text: ${(photoError as Error).message}`,
      );
      await ctx.reply(caption, {
        parse_mode: 'HTML',
        reply_markup: buttons.reply_markup,
      });
    }
  }

  /**
   * Создать платёжную сессию для покупки новой основной подписки
   */
  async handleBuyMainPlan(ctx: CallbackContext, planId: number): Promise<void> {
    await ctx.answerCbQuery();

    const plan = await this.planRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      await ctx.reply('⚠️ Тариф не найден. Попробуйте снова.');
      return;
    }

    const telegramId = ctx.callbackQuery.from.id.toString();

    try {
      const session = await this.paymentsService.createSession({
        telegramId,
        period: plan.months,
        amount: plan.price,
        forceNewSubscription: false,
        ttlMinutes: 60,
        referrerId: ctx.session.referrerId ?? undefined,
        planMetadata: JSON.stringify({
          label: plan.label,
          dataLimitGB: plan.dataLimitGB ?? 0,
          planType: plan.planType,
          isMain: true,
        }),
      });

      const paymentResult = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId,
        description: `VPN HIT: ${plan.label}`,
      });
      await this.paymentsService.setFkOrderId(session.invId, paymentResult.fkOrderId);

      try { await ctx.deleteMessage(); } catch {}

      const buttons = Markup.inlineKeyboard([
        { text: '💳 Перейти к оплате', url: paymentResult.url },
        { text: '◀️ Назад в меню', callback_data: BotCallbacks.Menu },
      ], { columns: 1 });

      await ctx.reply(
        `💳 <b>Оплата VPN HIT</b>\n\n` +
        `📦 Тариф: <b>${plan.label}</b>\n\n` +
        `💰 Сумма: <b>${plan.price} ₽</b>\n\n` +
        `⏳ Ссылка действует <b>60 минут</b>. После оплаты подписка активируется автоматически.`,
        { parse_mode: 'HTML', reply_markup: buttons.reply_markup },
      );
    } catch (error) {
      this.logger.error(`Failed to create main sub payment for ${telegramId}:`, error);
      await ctx.reply('⚠️ Не удалось создать платёжную ссылку. Попробуйте позже.');
    }
  }

  /**
   * Инструкция по подключению
   */
  async showInstructions(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const telegramId = ctx.callbackQuery.from.id.toString();
    const subPageUrl = await this.getPrimarySubPageUrl(telegramId);
    if (subPageUrl) {
      await ctx.reply(
        `📖 <b>Как подключить VPN HIT</b>\n\nОткройте страницу подписки. Там доступны ссылка, QR и инструкции для подключения устройства.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '📖 Открыть страницу подписки', url: subPageUrl }],
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ]).reply_markup,
        },
      );
      return;
    }

    const fallbackText =
      `📖 <b>Как подключить VPN HIT</b>\n\n` +
      `1. Откройте раздел <b>«Моя подписка»</b>.\n` +
      `2. Скопируйте ссылку или откройте страницу подключения.\n` +
      `3. Подключите устройство по инструкции на странице.\n\n` +
      `💬 Если что-то не работает — напишите в поддержку.`;
    const fallbackButtons = [[{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }]];

    const [text, dynamicButtons] = await Promise.all([
      this.getPageText('instructions', fallbackText),
      this.getPageButtons('instructions'),
    ]);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard((dynamicButtons ?? fallbackButtons) as any).reply_markup,
    });
  }

  async showMySubscription(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const telegramId = ctx.callbackQuery.from.id.toString();
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(telegramId);

    if (!activeSub) {
      const buttons: any[][] = [];
      buttons.push([{ text: '💳 Купить подписку', callback_data: BotCallbacks.BuySubscription }]);
      buttons.push([{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }]);

      await ctx.reply(`📱 <b>Моя подписка</b>\n\nУ вас нет активной подписки.`, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      });
      return;
    }

    const subPageUrl = await this.subscriptionsService.getSubPageUrl(activeSub.id);
    if (subPageUrl) {
      await ctx.reply(
        `🔑 <b>Моя подписка</b>\n\nОткройте страницу подписки для управления доступом, подключения устройств и продления.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '📱 Открыть подписку', url: subPageUrl }],
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ]).reply_markup,
        },
      );
      return;
    }

      await ctx.reply(`🔑 <b>Моя подписка</b>\n\nПодписка найдена, но ссылка на страницу пока недоступна.`, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [{ text: '🔄 Обновить', callback_data: BotCallbacks.MySubscription }],
        [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
      ]).reply_markup,
    });
  }

  /**
   * Показать дополнительные подписки с пагинацией
   */
  async showAdditionalSubscriptions(ctx: CallbackContext, page = 0): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const telegramId = ctx.callbackQuery.from.id.toString();
    const allSubs = await this.subscriptionsService.getAllSubscriptionsByTelegramId(telegramId);
    const addSubs = allSubs.filter((s) => s.isAdditional);

    if (addSubs.length === 0) {
      const fallbackText =
        `📦 <b>Дополнительные подписки</b>\n\n` +
        `У вас пока нет дополнительных подписок.\n\n` +
        `🎁 Вы можете создать дополнительную подписку в разделе оплаты, чтобы использовать её на другом устройстве или подарить другу.`;
      const fallbackButtons = [
        [{ text: '🔧 Купить дополнительную', callback_data: BotCallbacks.BuyAdditional }],
        [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
      ];
      const [emptyText, emptyButtons] = await Promise.all([
        this.getPageText('my_additional_empty', fallbackText),
        this.getPageButtons('my_additional_empty'),
      ]);
      await ctx.reply(emptyText, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard((emptyButtons ?? fallbackButtons) as any).reply_markup,
      });
      return;
    }

    const PAGE_SIZE = 5;
    const totalPages = Math.ceil(addSubs.length / PAGE_SIZE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const pageSubs = addSubs.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const subButtons = pageSubs.map((sub) => {
      const nameLabel = sub.name ? sub.name : `Подписка ${sub.id.slice(0, 8)}`;
      const dateStr = sub.createdAt
        ? new Date(sub.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : '';
        return [{ text: `${nameLabel}${dateStr ? ` (${dateStr})` : ''}`, callback_data: `sub_detail_${sub.id}` }];
    });

    const navButtons: { text: string; callback_data: string }[] = [];
    if (currentPage > 0) navButtons.push({ text: '◀️ Пред.', callback_data: `add_subs_page_${currentPage - 1}` });
    if (currentPage < totalPages - 1) navButtons.push({ text: 'След. ▶️', callback_data: `add_subs_page_${currentPage + 1}` });

    const allButtons: { text: string; callback_data: string }[][] = [...subButtons];
    if (navButtons.length > 0) allButtons.push(navButtons);
    allButtons.push([{ text: '🔧 Купить дополнительную', callback_data: BotCallbacks.BuyAdditional }]);
    allButtons.push([{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }]);

    const pageInfo = totalPages > 1 ? ` (стр. ${currentPage + 1}/${totalPages})` : '';
    await ctx.reply(
      `📦 <b>Дополнительные подписки${pageInfo}</b> — ${addSubs.length} шт.\n\nВыберите подписку для просмотра:`,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(allButtons).reply_markup },
    );
  }

  /**
   * Отправить сообщение пользователям бота
   */
  async sendMessage(message: string, telegramId?: string, photoBuffer?: Buffer): Promise<{
    sent: number;
    failed: number;
    errors: string[];
  }> {
    if (!this.bot) {
      throw new Error('Bot instance not available');
    }

    const errors: string[] = [];

    // Вспомогательная функция для отправки одного сообщения
    const sendToUser = async (userId: string): Promise<void> => {
      if (photoBuffer) {
        await this.bot.telegram.sendPhoto(userId, { source: photoBuffer }, {
          caption: message,
          parse_mode: 'HTML',
        });
      } else {
        await this.bot.telegram.sendMessage(userId, message, {
          parse_mode: 'HTML',
        });
      }
    };

    // Если указан telegramId - отправляем одному пользователю
    if (telegramId) {
      try {
        await sendToUser(telegramId);
        this.logger.log(`Message sent to user ${telegramId}`);
        return { sent: 1, failed: 0, errors: [] };
      } catch (error) {
        const errorMsg = `Failed to send message to ${telegramId}: ${(error as Error).message}`;
        this.logger.error(errorMsg);
        errors.push(errorMsg);
        return { sent: 0, failed: 1, errors };
      }
    }

    // Иначе - получаем все уникальные Telegram ID из БД
    const uniqueTelegramIds = await this.subscriptionsService.getUniqueTelegramIds();
    
    if (uniqueTelegramIds.length === 0) {
      this.logger.warn('No Telegram IDs found in subscriptions');
      return { sent: 0, failed: 0, errors: ['No Telegram IDs found'] };
    }

    this.logger.log(`Broadcasting message to ${uniqueTelegramIds.length} users...`);

    let sent = 0;
    let failed = 0;

    // Отправляем с небольшими задержками, чтобы не словить rate limit
    for (const userId of uniqueTelegramIds) {
      try {
        await sendToUser(userId);
        sent++;
        this.logger.log(`Message sent to user ${userId}`);
        
        // Задержка 50мс между сообщениями
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        failed++;
        const errorMsg = `Failed to send to ${userId}: ${(error as Error).message}`;
        this.logger.warn(errorMsg);
        errors.push(errorMsg);
      }
    }

    this.logger.log(`Broadcast complete: ${sent} sent, ${failed} failed`);
    return { sent, failed, errors };
  }

  /**
   * Отправить уведомление о скором окончании подписки
   */
  async notifySubscriptionExpiringSoon(telegramId: string, endDate: Date): Promise<boolean> {
    try {
      const endDateStr = endDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const subPageUrl = await this.getPrimarySubPageUrl(telegramId);
      const fallbackMessage =
        `⚠️ <b>Ваш доступ скоро истекает!</b>\n\n` +
        `📅 Дата окончания: ${endDateStr}\n\n` +
        `💡 Продлите доступ прямо сейчас, чтобы не потерять соединение!`;

      const fallbackBtns = subPageUrl
        ? [
            [{ text: '📱 Открыть подписку', url: subPageUrl }],
            [{ text: '📖 Инструкции', url: subPageUrl }],
          ]
        : [
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ];

      const [message, dynamicButtons] = await Promise.all([
        this.getPageText('subscription_expiring', fallbackMessage, { endDate: endDateStr }),
        this.getPageButtons('subscription_expiring'),
      ]);

      const buttons = Markup.inlineKeyboard((dynamicButtons ?? fallbackBtns) as any);
      await this.maxApiService.sendMessage(telegramId, message, {
        parse_mode: 'HTML',
        reply_markup: buttons.reply_markup as any,
      });

      this.logger.log(`Expiring notification sent to user ${telegramId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send expiring notification to ${telegramId}:`, error);
      return false;
    }
  }

  // ─── Все подписки ───

  /** Показать детали конкретной подписки */
  async showSubDetail(ctx: CallbackContext, subId: string): Promise<void> {
    await ctx.answerCbQuery();

    const sub = await this.subscriptionsService.findById(subId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    try { await ctx.deleteMessage(); } catch {}

    const ru = sub.remnawaveUuid
      ? await this.remnawaveApiService.getUserByUuid(sub.remnawaveUuid).catch(() => null)
      : sub.username
        ? await this.remnawaveApiService.getUserByUsername(sub.username).catch(() => null)
        : null;

    const statusEmoji: Record<string, string> = {
      ACTIVE: '✅', EXPIRED: '❌', DISABLED: '🚫', LIMITED: '⚠️',
    };
    const statusLabel: Record<string, string> = {
      ACTIVE: 'Активна', EXPIRED: 'Истекла', DISABLED: 'Отключена', LIMITED: 'Лимит исчерпан',
    };

    const emoji = ru ? (statusEmoji[ru.status] ?? '❓') : '❓';
    const statusText = ru ? (statusLabel[ru.status] ?? ru.status) : 'Неизвестно';
    const expireLabel = ru?.expireAt ? formatDate(new Date(ru.expireAt)) : '—';
    const shortUuid = sub.shortUuid ?? ru?.shortUuid ?? null;
    const subPageUrl = this.remnawaveApiService.buildSubPageUrl(shortUuid);

    const hwidLimit = ru?.hwidDeviceLimit ?? 5;

    const lines: string[] = [
      `<b>Подписка</b>  ${emoji} ${statusText}`,
      `\n📅 Действует до: <b>${expireLabel}</b>`,
      `\n💻 Лимит устройств: <b>${hwidLimit}</b>`,
    ];

    const buttons: any[][] = [];
    if (subPageUrl) {
      buttons.push([{ text: '📱 Подключить устройство', url: subPageUrl }]);
    }
    buttons.push([{ text: '📱 Устройства', callback_data: `sub_devices_${sub.id}` }]);
    if (hwidLimit < 10) {
      buttons.push([{ text: '➕ Купить слоты устройств', callback_data: `buy_dev_slots_${sub.id}` }]);
    }
    buttons.push([{ text: '🔄 Продлить подписку', callback_data: `renew_sub_${sub.id}` }]);
    if (sub.isAdditional) {
      buttons.push([{ text: '🗑 Удалить подписку', callback_data: `sub_del_confirm_${sub.id}` }]);
    }
    const backCb = sub.isAdditional ? BotCallbacks.MyAdditionalSubscriptions : BotCallbacks.MySubscription;
    buttons.push([{ text: '◀️ Назад', callback_data: backCb }]);

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      disable_web_page_preview: true,
    } as any);
  }

  /** Запрос подтверждения удаления подписки */
  async confirmDeleteSub(ctx: CallbackContext, subId: string): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    await ctx.reply(
      '⚠️ <b>Удалить подписку?</b>\n\nЭто действие необратимо — подписка будет удалена из системы.',
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '🗑 Да, удалить', callback_data: `sub_delete_${subId}` }],
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      },
    );
  }

  /** Удалить подписку после подтверждения */
  async handleDeleteSub(ctx: CallbackContext, subId: string): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    try {
      await this.subscriptionsService.deleteSubscription(subId);
      await ctx.reply(
        '✅ <b>Подписка удалена.</b>',
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '📦 Дополнительные подписки', callback_data: BotCallbacks.MyAdditionalSubscriptions }],
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ]).reply_markup,
        },
      );
    } catch (error) {
      this.logger.error(`Failed to delete subscription ${subId}:`, error);
      await ctx.reply('⚠️ Не удалось удалить подписку. Попробуйте позже.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: BotCallbacks.MyAdditionalSubscriptions }],
        ]).reply_markup,
      });
    }
  }

  /** Показать список устройств подписки */
  async showSubDevices(ctx: CallbackContext, subId: string): Promise<void> {
    await ctx.answerCbQuery();

    const telegramId = ctx.callbackQuery.from.id.toString();
    const sub = await this.subscriptionsService.findById(subId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    const userUuid = sub.remnawaveUuid
      ?? (sub.username
        ? (await this.remnawaveApiService.getUserByUsername(sub.username).catch(() => null))?.uuid ?? null
        : null);

    if (!userUuid) {
      await ctx.reply('⚠️ Не удалось получить данные подписки.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      });
      return;
    }

    let devices: RemnawaveHwidDevice[] = [];
    try {
      devices = await this.remnawaveApiService.getHwidDevices(userUuid);
    } catch (error) {
      this.logger.error(`Failed to get HWID devices for sub ${subId}:`, error);
      await ctx.reply('⚠️ Не удалось загрузить список устройств. Попробуйте позже.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      });
      return;
    }

    // Сохраняем в кеш для последующего удаления по индексу
    const cacheKey = `${telegramId}_${subId}`;
    this.deviceCache.set(cacheKey, devices);

    try { await ctx.deleteMessage(); } catch {}

    if (devices.length === 0) {
      await ctx.reply(
        `📱 <b>Устройства</b>\n\n` +
        `Нет подключённых устройств.\n\n` +
        `ℹ️ Устройства появляются после первого подключения через приложение.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
          ]).reply_markup,
        },
      );
      return;
    }

    const deviceButtons = devices.map((d, i) => {
      const name = d.userAgent ? d.userAgent.slice(0, 30) : `Устройство ${i + 1}`;
      return [{ text: `🗑 ${name}`, callback_data: `sub_dev_del_${subId}_${i}` }];
    });
    deviceButtons.push([{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }]);

    await ctx.reply(
      `📱 <b>Устройства (${devices.length})</b>\n\n` +
      `Нажмите на устройство, чтобы <b>удалить</b> его из вашей подписки.\n` +
      `⚠️ После удаления устройство сможет снова подключиться при следующем подключении.`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(deviceButtons).reply_markup,
      },
    );
  }

  /** Удалить устройство из подписки */
  async handleDeleteDevice(ctx: CallbackContext, subId: string, deviceIndex: number): Promise<void> {
    await ctx.answerCbQuery();

    const telegramId = ctx.callbackQuery.from.id.toString();
    const cacheKey = `${telegramId}_${subId}`;
    const devices = this.deviceCache.get(cacheKey);

    if (!devices || deviceIndex < 0 || deviceIndex >= devices.length) {
      await ctx.reply(
        '⚠️ Устройство не найдено. Откройте список устройств снова.',
        {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '📱 Устройства', callback_data: `sub_devices_${subId}` }],
            [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
          ]).reply_markup,
        },
      );
      return;
    }

    const device = devices[deviceIndex];
    const sub = await this.subscriptionsService.findById(subId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    const userUuid = sub.remnawaveUuid
      ?? (sub.username
        ? (await this.remnawaveApiService.getUserByUsername(sub.username).catch(() => null))?.uuid ?? null
        : null);

    if (!userUuid) {
      await ctx.reply('⚠️ Не удалось получить данные подписки.');
      return;
    }

    try {
      await this.remnawaveApiService.deleteHwidDevice(userUuid, device.hwid);
      // Обновляем кеш — убираем удалённое устройство
      this.deviceCache.set(cacheKey, devices.filter((_, i) => i !== deviceIndex));
    } catch (error) {
      this.logger.error(`Failed to delete HWID device for sub ${subId}:`, error);
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply('⚠️ Не удалось удалить устройство. Попробуйте позже.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '📱 Устройства', callback_data: `sub_devices_${subId}` }],
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      });
      return;
    }

    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(
      `✅ <b>Устройство удалено.</b>`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '📱 Устройства', callback_data: `sub_devices_${subId}` }],
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      },
    );
  }

  // ─── Покупка слотов устройств ───

  /** Показать список тарифов для покупки дополнительных слотов устройств */
  async showBuyDeviceSlots(ctx: CallbackContext, subId: string): Promise<void> {
    await ctx.answerCbQuery();

    const sub = await this.subscriptionsService.findById(subId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    const ru = sub.remnawaveUuid
      ? await this.remnawaveApiService.getUserByUuid(sub.remnawaveUuid).catch(() => null)
      : null;

    const currentLimit = ru?.hwidDeviceLimit ?? 5;

    if (currentLimit >= 10) {
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply(
        `💻 <b>Лимит устройств</b>\n\nДостигнут максимум — <b>10 устройств</b>.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
          ]).reply_markup,
        },
      );
      return;
    }

    const plans = await this.deviceSlotPlanRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });

    if (plans.length === 0) {
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply('⚠️ Тарифы слотов устройств временно недоступны. Попробуйте позже.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }],
        ]).reply_markup,
      });
      return;
    }

    // Сохраняем subId в сессии для последующего шага
    ctx.session.pendingDeviceSubId = subId;

    const buttons: any[][] = plans
      .filter((p) => currentLimit + p.slotsCount <= 10)
      .map((p) => [{
        text: `${p.label} — ${p.price} ₽ (будет: ${currentLimit + p.slotsCount})`,
        callback_data: `buy_dev_slot_plan_${p.id}`,
      }]);
    buttons.push([{ text: '◀️ Назад', callback_data: `sub_detail_${subId}` }]);

    try { await ctx.deleteMessage(); } catch {}

    await ctx.reply(
      `💻 <b>Слоты устройств</b>\n\n` +
      `Текущий лимит: <b>${currentLimit}</b> \n\n` +
      `Выберите пакет для добавления:`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
      },
    );
  }

  /** Обработать выбор тарифа слотов — создать платёжную сессию */
  async handleBuyDeviceSlotPlan(ctx: CallbackContext, planId: number): Promise<void> {
    await ctx.answerCbQuery();

    const subId = ctx.session.pendingDeviceSubId as string | undefined;
    if (!subId) {
      await ctx.reply('⚠️ Сессия истекла. Вернитесь к подписке и попробуйте снова.');
      return;
    }

    const plan = await this.deviceSlotPlanRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      await ctx.reply('⚠️ Тариф не найден. Попробуйте снова.');
      return;
    }

    const sub = await this.subscriptionsService.findById(subId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    const ru = sub.remnawaveUuid
      ? await this.remnawaveApiService.getUserByUuid(sub.remnawaveUuid).catch(() => null)
      : null;

    const currentLimit = ru?.hwidDeviceLimit ?? 5;
    const newLimit = Math.min(currentLimit + plan.slotsCount, 10);

    if (currentLimit >= 10) {
      await ctx.reply('⚠️ Лимит устройств уже достигнут (10 из 10).');
      return;
    }

    const telegramId = ctx.callbackQuery.from.id.toString();

    try {
      const session = await this.paymentsService.createSession({
        telegramId,
        period: 1,
        amount: plan.price,
        subscriptionId: subId,
        forceNewSubscription: false,
        ttlMinutes: 60,
        planMetadata: JSON.stringify({
          type: 'device_slots',
          slotsCount: plan.slotsCount,
          newLimit,
          label: plan.label,
        }),
      });

      const paymentResult = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId,
        description: `Слоты устройств: ${plan.label}`,
      });
      await this.paymentsService.setFkOrderId(session.invId, paymentResult.fkOrderId);

      ctx.session.pendingDeviceSubId = undefined;

      const buttons = Markup.inlineKeyboard([
        { text: '💳 Перейти к оплате', url: paymentResult.url },
        { text: '◀️ Назад', callback_data: `sub_detail_${subId}` },
      ], { columns: 1 });

      try { await ctx.deleteMessage(); } catch {}

      await ctx.reply(
        `💳 <b>Оплата слотов устройств</b>\n\n` +
        `📦 Пакет: <b>${plan.label}</b>\n` +
        `💻 Лимит после оплаты: <b>${newLimit}</b> устройств\n` +
        `💰 Сумма: <b>${plan.price} ₽</b>\n\n` +
        `⏳ Ссылка действует <b>60 минут</b>.`,
        { parse_mode: 'HTML', reply_markup: buttons.reply_markup },
      );
    } catch (error) {
      this.logger.error(`Failed to create device slot payment for ${telegramId}:`, error);
      await ctx.reply('⚠️ Не удалось создать платёжную ссылку. Попробуйте позже.');
    }
  }

  // ─── Вспомогательные методы для динамических страниц ───

  /**
   * Возвращает текст страницы из БД или fallback-строку.
   * Интерполирует {{переменные}} если переданы vars.
   */
  private async getPageText(key: string, fallback: string, vars?: Record<string, string>): Promise<string> {
    try {
      const page = await this.botPagesService.findByKey(key);
      if (page && page.text) {
        return vars ? this.botPagesService.interpolate(page.text, vars) : page.text;
      }
    } catch {
      // если БД недоступна — используем fallback
    }
    return vars ? this.botPagesService.interpolate(fallback, vars) : fallback;
  }

  /**
   * Конвертирует BotButton[][] в формат Telegraf inlineKeyboard.
   * Если массив пуст — возвращает null (использовать hardcoded кнопки).
   */
  private async getPageButtons(key: string): Promise<Array<Array<{ text: string; callback_data?: string; url?: string }>> | null> {
    try {
      const page = await this.botPagesService.findByKey(key);
      if (page && page.buttons && page.buttons.length > 0) {
        return page.buttons.map(row =>
          row.map(btn => {
            const b: { text: string; callback_data?: string; url?: string } = { text: btn.text };
            if (btn.callbackData) b.callback_data = btn.callbackData;
            if (btn.url) b.url = btn.url;
            return b;
          }),
        );
      }
    } catch {}
    return null;
  }

  // ─── Покупка подписки (новый флоу) ───

  /**
   * Экран выбора тарифа подписки
   */
  async showBuySubscription(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const fallbackText = `💳 <b>Выберите тариф подписки</b>\n\n` +
      `✅ Безлимитный трафик\n` +
      `✅ Высокая скорость\n` +
      `✅ Работают все сервисы\n`;

    const plans = await this.getPlans(false);
    if (plans.length === 0) {
      await ctx.reply('⚠️ Тарифы временно недоступны. Попробуйте позже.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Назад', callback_data: BotCallbacks.Menu }],
        ]).reply_markup,
      });
      return;
    }

    const telegramId = ctx.callbackQuery.from.id.toString();
    const allSubs = await this.subscriptionsService.getAllSubscriptionsByTelegramId(telegramId);
    const mainSub = allSubs.find((s) => !s.isAdditional) ?? null;

    if (mainSub) {
      // У пользователя уже есть подписка — показываем продление
      ctx.session.pendingSubId = mainSub.id;
      ctx.session.pendingSubIsAnti = false;

      const planButtons = plans.map((plan) => {
        const btnLabel = `+${plan.months} мес — ${plan.price} ₽`;
        return [{ text: btnLabel, callback_data: `renew_plan_${plan.id}` }];
      });
      planButtons.push([{ text: '◀️ Назад', callback_data: BotCallbacks.Menu }]);

      await ctx.reply(
        `🔄 <b>Продление подписки</b>\n\n<b>Выберите тариф:</b>`,
        { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(planButtons).reply_markup },
      );
    } else {
      // Новая покупка
      const planButtons = plans.map((plan) => {
        const btnLabel = `${plan.label} — ${plan.months} мес — ${plan.price} ₽`;
        return [{ text: btnLabel, callback_data: `buy_main_plan_${plan.id}` }];
      });
      planButtons.push([{ text: '◀️ Назад', callback_data: BotCallbacks.Menu }]);

      const [text, dynamicButtons] = await Promise.all([
        this.getPageText('buy_subscription', fallbackText),
        this.getPageButtons('buy_subscription'),
      ]);

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard((dynamicButtons ?? planButtons) as any).reply_markup,
      });
    }
  }

  /** Выбор тарифа подписки (совместимость) */
  async showBuySubStd(ctx: CallbackContext): Promise<void> {
    await this.showBuySubscription(ctx);
  }

  /** Выбор тарифа подписки (совместимость) */
  async showBuySubAnti(ctx: CallbackContext): Promise<void> {
    await this.showBuySubscription(ctx);
  }

  /** Проверить, включена ли оплата для данного типа */
  private async isPaymentEnabled(isAntiThrottling: boolean): Promise<boolean> {    const key = isAntiThrottling
      ? 'anti_throttling_subscriptions_enabled'
      : 'standard_subscriptions_enabled';
    const row = await this.botStateRepository.findOne({ where: { name: key } });
    return row ? row.enabled : true;
  }

  /** Выбор типа дополнительной подписки (Базовый / Антиглушилка) */
  async showBuyAdditionalPlans(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const antiEnabled = await this.isPaymentEnabled(true);

    const hardcodedText = antiEnabled
      ? `🔧 <b>Дополнительная подписка</b>\n\nВыберите тип подписки:\n\n🌐 <b>Базовый</b> — безлимитный трафик, доступ ко всем сервисам\n\n⚡ <b>Антиглушилка</b> — обход блокировок мессенджеров и соцсетей\n✅ Работает: WhatsApp, Telegram, Instagram\n❌ Не работает: YouTube, ChatGPT и другие сервисы, заблокированные в России`
      : `🔧 <b>Дополнительная подписка</b>\n\nВыберите тариф:\n\n🌐 <b>Базовый</b> — безлимитный трафик, доступ ко всем сервисам`;

    const hardcodedButtons = antiEnabled
      ? [
          [{ text: '🌐 Базовый', callback_data: BotCallbacks.BuyAdditionalStd }],
          [{ text: '⚡ Антиглушилка', callback_data: BotCallbacks.BuyAdditionalAnti }],
          [{ text: '◀️ Назад', callback_data: BotCallbacks.MyAdditionalSubscriptions }],
        ]
      : [
          [{ text: '🌐 Базовый', callback_data: BotCallbacks.BuyAdditionalStd }],
          [{ text: '◀️ Назад', callback_data: BotCallbacks.MyAdditionalSubscriptions }],
        ];

    const [text, dynamicButtons] = await Promise.all([
      this.getPageText('buy_additional_type_select', hardcodedText),
      this.getPageButtons('buy_additional_type_select'),
    ]);

    const effectiveButtons = !antiEnabled && dynamicButtons
      ? dynamicButtons.filter(row => !row.some(btn => btn.callback_data === BotCallbacks.BuyAdditionalAnti))
      : dynamicButtons;

    await ctx.reply(antiEnabled ? text : hardcodedText, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard((effectiveButtons ?? hardcodedButtons) as any).reply_markup,
    });
  }

  /** Список тарифов выбранного типа для дополнительной подписки */
  async showBuyAdditionalPlansByType(ctx: CallbackContext, isAntiThrottling: boolean): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    if (!(await this.isPaymentEnabled(isAntiThrottling))) {
      const typeLabel = isAntiThrottling ? 'антиглушилки' : 'стандартных подписок';
      await ctx.reply(
        `⛔ <b>Покупка ${typeLabel} временно отключена.</b>\n\nПопробуйте позже.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ]).reply_markup,
        },
      );
      return;
    }

    const plans = await this.getAdditionalPlans(isAntiThrottling);
    if (plans.length === 0) {
      await ctx.reply(
        '⚠️ Тарифы временно недоступны. Попробуйте позже.',
        { reply_markup: Markup.inlineKeyboard([[{ text: '◀️ Назад', callback_data: BotCallbacks.BuyAdditional }]]).reply_markup },
      );
      return;
    }

    const typeLabel = isAntiThrottling ? '⚡ Антиглушилка' : '🌐 Базовый';
    const planButtons = plans.map((plan) => {
      const btnLabel = plan.dataLimitGB && plan.dataLimitGB > 0
        ? `${plan.label} — ${plan.dataLimitGB} ГБ — ${plan.price} ₽`
        : `${plan.label} — ${plan.months} мес — ${plan.price} ₽`;
      return [{ text: btnLabel, callback_data: `buy_plan_add_${plan.id}` }];
    });
    planButtons.push([{ text: '◀️ Назад', callback_data: BotCallbacks.BuyAdditional }]);

    // Для заголовка используем страницу из БД (только текст; кнопки = динамические тарифы)
    const hardcodedAntiInfo = isAntiThrottling
      ? `\n\n✅ Работает: WhatsApp, Telegram, Instagram\n❌ Не работает: YouTube, ChatGPT и другие сервисы, заблокированные в России\n`
      : '';
    const hardcodedHeader = `🔧 <b>Дополнительная подписка — ${typeLabel}</b>${hardcodedAntiInfo}\n<b>Выберите тариф:</b>`;
    const pageKey = isAntiThrottling ? 'anti_throttling_description' : null;
    const headerText = pageKey
      ? await this.getPageText(pageKey, hardcodedHeader)
      : hardcodedHeader;

    await ctx.reply(
      headerText,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(planButtons).reply_markup },
    );
  }

  /** Создать платёжную сессию для дополнительной подписки */
  async handleBuyAdditionalPlan(ctx: CallbackContext, planId: number): Promise<void> {
    await ctx.answerCbQuery();

    const plan = await this.planRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      await ctx.reply('⚠️ Тариф не найден. Попробуйте снова.');
      return;
    }

    // Устанавливаем состояние ожидания названия
    ctx.session.status = 'awaiting_add_sub_name';
    ctx.session.pendingAddPlanId = planId;

    try { await ctx.deleteMessage(); } catch {}

    const planInfo = plan.dataLimitGB && plan.dataLimitGB > 0
      ? `${plan.label} — ${plan.dataLimitGB} ГБ — ${plan.price} ₽`
      : `${plan.label} — ${plan.months} мес — ${plan.price} ₽`;

    await ctx.reply(
      `✏️ <b>Название подписки</b>\n\n` +
      `Тариф: <b>${planInfo}</b>\n\n` +
      `Введите название для этой подписки (до 30 символов).\n` +
      `Оно поможет найти её в разделе «Дополнительные подписки».\n\n` +
      `Примеры: <i>«Работа», «Дача», «iPhone», «Брат»</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [{ text: '◀️ Отмена', callback_data: BotCallbacks.BuyAdditional }],
        ]).reply_markup,
      },
    );
  }

  /**
   * Обработать ввод названия дополнительной подписки
   */
  async handleAdditionalSubNameInput(ctx: MessageContext): Promise<void> {
    const telegramId = ctx.message?.from?.id?.toString();
    const planId = ctx.session.pendingAddPlanId as number | undefined;

    if (!planId || !telegramId) {
      ctx.session.status = undefined;
      return;
    }

    // Санируем: убираем HTML-символы и обрезаем
    const rawName = (ctx.message.text ?? '').trim();
    const cleanName = rawName.replace(/[<>&"']/g, '').slice(0, 30).trim();

    if (!cleanName) {
      await ctx.reply(
        '⚠️ Название не может быть пустым. Введите название подписки:',
        {
          reply_markup: Markup.inlineKeyboard([
            [{ text: '◀️ Отмена', callback_data: BotCallbacks.BuyAdditional }],
          ]).reply_markup,
        },
      );
      return; // Оставляем состояние активным
    }

    // Сбрасываем состояние
    ctx.session.status = undefined;
    ctx.session.pendingAddPlanId = undefined;

    const plan = await this.planRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      await ctx.reply('⚠️ Тариф не найден. Попробуйте снова.');
      return;
    }

    try {
      const session = await this.paymentsService.createSession({
        telegramId,
        period: plan.months,
        amount: plan.price,
        forceNewSubscription: true,
        ttlMinutes: 60,
        referrerId: ctx.session.referrerId ?? undefined,
        planMetadata: JSON.stringify({
          label: plan.label,
          dataLimitGB: plan.dataLimitGB ?? 0,
          planType: plan.planType,
          isMain: false,
          subscriptionName: cleanName,
        }),
      });

      const paymentResult = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId,
        description: `Доп. подписка: ${cleanName}`,
      });
      await this.paymentsService.setFkOrderId(session.invId, paymentResult.fkOrderId);

      const buttons = Markup.inlineKeyboard([
        { text: '💳 Перейти к оплате', url: paymentResult.url },
        { text: '◀️ Назад в меню', callback_data: BotCallbacks.Menu },
      ], { columns: 1 });

      await ctx.reply(
        `💳 <b>Оплата доступа</b>\n\n` +
        `📦 Тариф: <b>${plan.label}</b>\n` +
        `📝 Название: <b>${cleanName}</b>\n` +
        `💰 Сумма: <b>${plan.price} ₽</b>\n\n` +
        `⏳ Ссылка действует <b>60 минут</b>.\n` +
        `После оплаты подписка активируется автоматически.`,
        { parse_mode: 'HTML', reply_markup: buttons.reply_markup },
      );
    } catch (error) {
      this.logger.error(`Failed to create payment session for ${telegramId}:`, error);
      await ctx.reply('⚠️ Не удалось создать платёжную ссылку. Попробуйте позже.');
    }
  }

  // ─── Продление ───

  /** Пользователь нажал «Продлить» в детальном просмотре подписки → показываем тарифы */
  async handleRenewSubSelected(ctx: CallbackContext, subscriptionId: string): Promise<void> {
    await ctx.answerCbQuery();

    const sub = await this.subscriptionsService.findById(subscriptionId);
    if (!sub) {
      await ctx.reply('⚠️ Подписка не найдена.');
      return;
    }

    if (!(await this.isPaymentEnabled(sub.isAntiThrottling))) {
      const typeLabel = sub.isAntiThrottling ? 'антиглушилки' : 'стандартных подписок';
      await ctx.reply(
        `⛔ <b>Продление ${typeLabel} временно отключено.</b>\n\nПопробуйте позже.`,
        {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
          ]).reply_markup,
        },
      );
      return;
    }

    ctx.session.pendingSubId = subscriptionId;
    ctx.session.pendingSubIsAnti = false;

    const plans = await this.getPlans(false);
    if (plans.length === 0) {
      await ctx.reply('⚠️ Тарифы временно недоступны. Попробуйте позже.');
      return;
    }

    const planButtons = plans.map((plan) => {
      const btnLabel = `+${plan.months} мес — ${plan.price} ₽`;
      return [{ text: btnLabel, callback_data: `renew_plan_${plan.id}` }];
    });
    planButtons.push([{ text: '◀️ Назад', callback_data: `sub_detail_${subscriptionId}` }]);

    try { await ctx.deleteMessage(); } catch {}

    await ctx.reply(
      `🔄 <b>Продление подписки</b>\n\n<b>Выберите тариф:</b>`,
      { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(planButtons).reply_markup },
    );
  }

  /** Создать платёжную сессию для продления выбранной подписки */
  async handleRenewPlan(ctx: CallbackContext, planId: number): Promise<void> {
    await ctx.answerCbQuery();

    const subscriptionId = ctx.session.pendingSubId as string | undefined;

    if (!subscriptionId) {
      await ctx.reply('⚠️ Сессия истекла. Вернитесь к подписке и попробуйте снова.', {
        reply_markup: Markup.inlineKeyboard([
          [{ text: '📱 Мои подписки', callback_data: BotCallbacks.MySubscription }],
        ]).reply_markup,
      });
      return;
    }

    const plan = await this.planRepository.findOne({ where: { id: planId, isActive: true } });
    if (!plan) {
      await ctx.reply('⚠️ Тариф не найден. Попробуйте снова.');
      return;
    }

    const telegramId = ctx.callbackQuery.from.id.toString();
    try {
      const session = await this.paymentsService.createSession({
        telegramId,
        period: plan.months,
        amount: plan.price,
        subscriptionId,
        ttlMinutes: 60,
        planMetadata: JSON.stringify({
          label: plan.label,
          dataLimitGB: plan.dataLimitGB ?? 0,
          planType: plan.planType,
        }),
      });

      const paymentResult = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId,
        description: `VPN HIT: ${plan.label}`,
      });
      await this.paymentsService.setFkOrderId(session.invId, paymentResult.fkOrderId);

      try { await ctx.deleteMessage(); } catch {}

      const buttons = Markup.inlineKeyboard([
        { text: '💳 Перейти к оплате', url: paymentResult.url },
        { text: '◀️ Назад в меню', callback_data: BotCallbacks.Menu },
      ], { columns: 1 });

      await ctx.reply(
        `💳 <b>Продление доступа</b>\n\n` +
        `📦 Тариф: <b>${plan.label}</b>\n` +
        `💰 Сумма: <b>${plan.price} ₽</b>\n\n` +
        `⏳ Ссылка действует <b>60 минут</b>.\n` +
        `После оплаты подписка продлится автоматически.`,
        { parse_mode: 'HTML', reply_markup: buttons.reply_markup },
      );
    } catch (error) {
      this.logger.error(`Failed to create renewal session for ${telegramId}:`, error);
      await ctx.reply('⚠️ Не удалось создать платёжную ссылку. Попробуйте позже.');
    }
  }

  // ─── Helpers ───

  private async getPlans(isAntiThrottling: boolean): Promise<Plan[]> {
    const planType = isAntiThrottling ? 'anti-throttling' : 'standard';
    return this.planRepository.find({
      where: { planType: planType as any, isActive: true, isMain: true },
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
  }

  private async getAdditionalPlans(isAntiThrottling?: boolean): Promise<Plan[]> {
    const planType = isAntiThrottling === undefined
      ? undefined
      : (isAntiThrottling ? 'anti-throttling' : 'standard');
    return this.planRepository.find({
      where: planType !== undefined ? { isActive: true, planType: planType as any } : { isActive: true },
      order: { sortOrder: 'ASC', price: 'ASC' },
    });
  }

  /**
   * Меню «О сервисе»
   */
  async showAboutMenu(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const fallbackText =
      `ℹ️ <b>О сервисе VPN HIT</b>\n\n` +
      `VPN HIT — это надёжный сервис для обеспечения вашего безопасного и анонимного доступа к интернету.\n\n` +
      `💬 Поддержка: @vpn_hit_support\n\n` +
      `Выберите раздел:`;
    const fallbackButtons = [
      [{ text: '🔒 Политика конфиденциальности', callback_data: BotCallbacks.PrivacyPolicy }],
      [{ text: '📄 Пользовательское соглашение', callback_data: BotCallbacks.TermsOfService }],
      [{ text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' }],
      [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
    ];

    const [text, dynamicButtons] = await Promise.all([
      this.getPageText('about_menu', fallbackText),
      this.getPageButtons('about_menu'),
    ]);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard((dynamicButtons ?? fallbackButtons) as any).reply_markup,
      disable_web_page_preview: true,
    } as any);
  }

  /**
   * Политика конфиденциальности
   */
  async showPrivacyPolicy(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const fallbackText =
      `🔒 <b>Политика конфиденциальности VPN HIT</b>\n` +
      `<i>Редакция от 01.01.2025</i>\n\n` +

      `<b>1. Какие данные мы собираем</b>\n` +
      `• Telegram ID и имя пользователя — для идентификации аккаунта.\n` +
      `• Данные об оплате (сумма, дата) — без хранения реквизитов карт.\n` +
      `• Мы <b>не ведём</b> логи вашего трафика и посещаемых сайтов.\n\n` +

      `<b>2. Как мы используем данные</b>\n` +
      `• Предоставление доступа к сервису.\n` +
      `• Отправка уведомлений об окончании подписки.\n` +
      `• Расчёт реферальных бонусов.\n` +
      `• Обработка платежей через платёжные системы.\n\n` +

      `<b>3. Передача данных третьим лицам</b>\n` +
      `Мы не продаём и не передаём ваши персональные данные третьим лицам.\n\n` +

      `<b>4. Хранение данных</b>\n` +
      `Данные хранятся на защищённых серверах.\n\n` +

      `<b>5. Ваши права</b>\n` +
      `Вы вправе запросить удаление ваших данных, обратившись в поддержку: @vpn_hit_support.`;

    const fallbackButtons = [
      [{ text: '◀️ Назад', callback_data: BotCallbacks.AboutMenu }],
    ];

    const [text, dynamicButtons] = await Promise.all([
      this.getPageText('privacy_policy', fallbackText),
      this.getPageButtons('privacy_policy'),
    ]);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard((dynamicButtons ?? fallbackButtons) as any).reply_markup,
    });
  }

  /**
   * Пользовательское соглашение
   */
  async showTermsOfService(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}

    const fallbackText =
      `📄 <b>Пользовательское соглашение VPN HIT</b>\n` +
      `<i>Редакция от 01.01.2025</i>\n\n` +

      `<b>1. Предмет соглашения</b>\n` +
      `VPN HIT предоставляет доступ к сервису для частных лиц. Используя сервис, вы принимаете условия данного соглашения.\n\n` +

      `<b>2. Условия использования</b>\n` +
      `• Сервис предназначен для личного использования.\n` +
      `• Передача доступа третьим лицам запрещена.\n` +
      `• Один аккаунт — один пользователь.\n\n` +

      `<b>3. Запрещённые действия</b>\n` +
      `Запрещается использовать сервис для:\n` +
      `• Совершения противоправных действий.\n` +
      `• Рассылки спама и вредоносного контента.\n` +
      `• Атак на сторонние сервисы.\n` +
      `• Нарушения авторских прав.\n\n` +

      `<b>4. Оплата и возврат</b>\n` +
      `• Оплата производится авансом за выбранный период.\n` +
      `• Возврат средств возможен в течение 24 часов с момента оплаты при условии, что подписка не была использована.\n` +
      `• Для возврата обратитесь в поддержку: @vpn_hit_support.\n\n` +

      `<b>5. Ограничение ответственности</b>\n` +
      `VPN HIT не несёт ответственности за перебои в работе, вызванные действиями провайдеров или форс-мажорными обстоятельствами.\n\n` +

      `<b>6. Изменения соглашения</b>\n` +
      `Мы оставляем за собой право изменять условия. Актуальная версия всегда доступна в боте.`;

    const fallbackButtons2 = [
      [{ text: '◀️ Назад', callback_data: BotCallbacks.AboutMenu }],
    ];

    const [text, dynamicButtons] = await Promise.all([
      this.getPageText('terms_of_service', fallbackText),
      this.getPageButtons('terms_of_service'),
    ]);

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard((dynamicButtons ?? fallbackButtons2) as any).reply_markup,
    });
  }

  /**
   * Получить экземпляр бота для использования в других сервисах
   */
  getBot(): Telegraf {
    return this.bot;
  }

  /**
   * Отправить уведомление в канал
   */
  async sendNotificationToChannel(
    message: string,
    parseMode: 'HTML' | 'Markdown' = 'HTML',
  ): Promise<boolean> {
    try {
      const telegram = this.configService.get('telegram');
      const channelId = telegram?.notificationChannelId;

      if (!channelId) {
        this.logger.warn('Notification channel ID not configured');
        return false;
      }

      if (!this.bot) {
        this.logger.warn('Bot not initialized');
        return false;
      }

      await this.bot.telegram.sendMessage(channelId, message, {
        parse_mode: parseMode,
      });

      this.logger.log(`Notification sent to channel ${channelId}`);
      return true;
    } catch (error) {
      this.logger.error('Failed to send notification to channel:', error);
      return false;
    }
  }

  async showReferral(ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    const telegramId = ctx.callbackQuery.from.id.toString();
    const referralLink = this.buildReferralLink(telegramId);

    const fallbackText =
      `👥 <b>Реферальная программа</b>\n\n` +
      `Приглашайте друзей и получайте бонусы!\n\n` +
      `🎁 <b>Ваш бонус за каждого приглашённого (при покупке основной подписки):</b>\n` +
      `• ⏳ <b>+10 дней</b> к вашей подписке\n\n` +
      `🔗 <b>Ваша реферальная ссылка:</b>\n` +
      `<code>${referralLink}</code>\n\n` +
      `📤 Поделитесь ссылкой с друзьями — бонус начислится автоматически после их первой покупки!`;

    const fallbackButtons = [
      [{ text: '📋 Скопировать код', callback_data: BotCallbacks.Referral }],
      [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
    ];

    // For dynamic share URL, always use fallback text/buttons (contain dynamic referralLink)
    try { await ctx.deleteMessage(); } catch {}
    await ctx.reply(fallbackText, {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard(fallbackButtons as any).reply_markup,
    });
  }

  private buildReferralLink(userId: string): string {
    const configuredBase = (this.configService.get<string>('max.referralBaseUrl') ?? '').replace(/\/+$/, '');
    if (configuredBase) {
      return `${configuredBase}?ref=${encodeURIComponent(userId)}`;
    }

    const botUsername = this.configService.get<string>('max.botUsername') || '';
    return botUsername ? `max://user/${botUsername}?ref=${encodeURIComponent(userId)}` : userId;
  }

  private async getPrimarySubPageUrl(telegramId: string): Promise<string | null> {
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(telegramId);
    if (!activeSub) {
      return null;
    }

    return this.subscriptionsService.getSubPageUrl(activeSub.id);
  }
}
