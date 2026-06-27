import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaxApiService } from '@modules/max-api';
import { SubscriptionsService } from '@modules/subscriptions';
import { PlansService } from '@modules/plans';
import { DeviceSlotPlansService } from '@modules/device-slot-plans';
import { PaymentsService } from '@modules/payments';
import { FreekassaService } from '@modules/payments';
import { ReferralService } from '@modules/referral';
import { PaymentNotificationService } from '@modules/payments';
import { BotCallbacks } from './constants/callbacks';
import { BotMessages } from './constants/messages';
import { Subscription, SubscriptionSource, Plan, DeviceSlotPlan } from '@database/entities';

/**
 * Service for handling MAX messenger bot logic.
 *
 * MAX API reference:
 *   - Webhook updates: message_created, message_callback, bot_started
 *   - User identified by user_id (= telegramId in our system)
 *   - Inline buttons use callback_data with BotCallbacks enum values
 */
@Injectable()
export class MaxBotService {
  private readonly logger = new Logger(MaxBotService.name);

  constructor(
    private readonly maxApi: MaxApiService,
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly plansService: PlansService,
    private readonly deviceSlotPlansService: DeviceSlotPlansService,
    private readonly paymentsService: PaymentsService,
    private readonly freekassaService: FreekassaService,
    private readonly referralService: ReferralService,
    private readonly paymentNotificationService: PaymentNotificationService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  // ─── Webhook entry point ────────────────────────────────────────────────

  /**
   * Main webhook handler. Dispatches based on update type.
   */
  async handleUpdate(body: any): Promise<void> {
    try {
      // MAX sends updates in "result" array or direct object
      const updates = Array.isArray(body?.result) ? body.result : [body];

      for (const update of updates) {
        await this.processUpdate(update);
      }
    } catch (error) {
      this.logger.error('Failed to process webhook update:', error);
    }
  }

  private async processUpdate(update: any): Promise<void> {
    const type = update.type || update.update_type;

    this.logger.debug(`Processing update type: ${type}`);

    switch (type) {
      case 'bot_started':
        await this.handleBotStarted(update);
        break;
      case 'message_created':
        await this.handleMessage(update);
        break;
      case 'message_callback':
        await this.handleCallback(update);
        break;
      default:
        this.logger.debug(`Unhandled update type: ${type}`);
    }
  }

  // ─── Bot started ───────────────────────────────────────────────────────

  /**
   * Handle /start command from user.
   * Supports deep-link: /start ref_{telegramId} for referrals.
   */
  private async handleBotStarted(update: any): Promise<void> {
    const userId = this.extractUserId(update);
    if (!userId) {
      this.logger.warn('bot_started without user_id');
      return;
    }

    const startParam = update.message?.text?.replace('/start', '').trim() || '';
    const referrerId = this.parseReferralParam(startParam);

    // Store referral if present and user doesn't have active subscription
    if (referrerId && referrerId !== userId) {
      await this.storeReferral(userId, referrerId);
    }

    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(userId);
    const balance = activeSub ? await this.calculateDaysLeft(activeSub) : 0;

    const welcomeText = this.interpolate(BotMessages.welcome, {
      userId,
      balance: `${balance} дн.`,
    });

    await this.maxApi.sendMessage(userId, welcomeText, {
      parse_mode: 'HTML',
      reply_markup: this.mainMenuKeyboard(),
    });
  }

  // ─── Text messages ─────────────────────────────────────────────────────

  /**
   * Handle incoming text messages (non-command).
   */
  private async handleMessage(update: any): Promise<void> {
    const userId = this.extractUserId(update);
    if (!userId) return;

    const text = update.message?.text?.trim() || '';

    // Check if user is in some flow state – for now just show main menu
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(userId);
    if (!activeSub) {
      await this.maxApi.sendMessage(userId, BotMessages.noActiveKeys, {
        parse_mode: 'HTML',
        reply_markup: this.mainMenuKeyboard(),
      });
      return;
    }

    await this.maxApi.sendMessage(userId, BotMessages.mainMenu, {
      parse_mode: 'HTML',
      reply_markup: this.mainMenuKeyboard(),
    });
  }

  // ─── Callback queries ──────────────────────────────────────────────────

  /**
   * Handle inline button callbacks.
   */
  private async handleCallback(update: any): Promise<void> {
    const userId = this.extractUserId(update);
    if (!userId) return;

    const callbackId = update.callback?.id || update.callback_id;
    const callbackData = update.callback?.payload || update.callback_data;

    // Answer callback to remove loading state
    if (callbackId) {
      await this.maxApi.answerCallback(callbackId).catch(() => {});
    }

    this.logger.debug(`Callback from ${userId}: ${callbackData}`);

    switch (callbackData) {
      case BotCallbacks.Menu:
        await this.showMainMenu(userId);
        break;

      case BotCallbacks.MySubscription:
        await this.showMySubscription(userId);
        break;

      case BotCallbacks.MyAdditionalSubscriptions:
        await this.showAdditionalSubscriptions(userId);
        break;

      case BotCallbacks.BuySubscription:
        await this.showBuySubscriptionMenu(userId);
        break;

      case BotCallbacks.BuySubStd:
        await this.showBuySubStd(userId);
        break;

      case BotCallbacks.BuySubAnti:
        await this.showBuySubAnti(userId);
        break;

      case BotCallbacks.BuyAdditional:
        await this.showBuyAdditionalMenu(userId);
        break;

      case BotCallbacks.BuyAdditionalStd:
        await this.showBuyAdditionalStd(userId);
        break;

      case BotCallbacks.BuyAdditionalAnti:
        await this.showBuyAdditionalAnti(userId);
        break;

      case BotCallbacks.BuyDeviceSlots:
        await this.showBuyDeviceSlots(userId);
        break;

      case BotCallbacks.Referral:
        await this.showReferral(userId);
        break;

      case BotCallbacks.Instructions:
        await this.showInstructions(userId);
        break;

      case BotCallbacks.AboutMenu:
        await this.showAboutMenu(userId);
        break;

      case BotCallbacks.PrivacyPolicy:
        await this.showPrivacyPolicy(userId);
        break;

      case BotCallbacks.TermsOfService:
        await this.showTermsOfService(userId);
        break;

      default:
        // Handle dynamic callbacks like "period_30", "buy_slot_1", "confirm_..."
        if (callbackData?.startsWith('period_')) {
          await this.handlePeriodSelection(userId, callbackData);
        } else if (callbackData?.startsWith('buy_slot_')) {
          await this.handleDeviceSlotSelection(userId, callbackData);
        } else if (callbackData?.startsWith('confirm_')) {
          await this.handleConfirm(userId, callbackData);
        } else {
          this.logger.debug(`Unknown callback: ${callbackData}`);
          await this.showMainMenu(userId);
        }
        break;
    }
  }

  // ─── Main menu ─────────────────────────────────────────────────────────

  private async showMainMenu(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.mainMenu, {
      parse_mode: 'HTML',
      reply_markup: this.mainMenuKeyboard(),
    });
  }

  private mainMenuKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📋 Мои подписки', callback_data: BotCallbacks.MySubscription },
        ],
        [
          { text: '🛒 Купить подписку', callback_data: BotCallbacks.BuySubscription },
        ],
        [
          { text: '📎 Доп. подписки', callback_data: BotCallbacks.MyAdditionalSubscriptions },
          { text: '💻 Слоты устройств', callback_data: BotCallbacks.BuyDeviceSlots },
        ],
        [
          { text: '🎉 Рефералка', callback_data: BotCallbacks.Referral },
          { text: '� Инструкции', callback_data: BotCallbacks.Instructions },
        ],
        [
          { text: '�️ О сервисе', callback_data: BotCallbacks.AboutMenu },
        ],
      ],
    };
  }

  // ─── My subscriptions ──────────────────────────────────────────────────

  private async showMySubscription(userId: string): Promise<void> {
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(userId);

    if (!activeSub) {
      await this.maxApi.sendMessage(userId, BotMessages.noSubscriptions, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '� Купить подписку', callback_data: BotCallbacks.BuySubscription }],
            [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
          ],
        },
      });
      return;
    }

    const enriched = await this.subscriptionsService.getSubPageUrl(activeSub.id);
    const expireDate = await this.getExpireDate(activeSub);
    const typeLabel = activeSub.isAntiThrottling ? '🛡 Антиглушилка' : '📦 Базовый';

    const text = this.interpolate(BotMessages.activeSubscription, {
      expireDate,
      type: typeLabel,
      devices: '5 устройств',
    });

    const keyboard: any[][] = [];

    if (enriched) {
      keyboard.push([{ text: '� Подключить устройство', url: enriched }]);
    }

    keyboard.push([{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]);

    await this.maxApi.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showAdditionalSubscriptions(userId: string): Promise<void> {
    const allSubs = await this.subscriptionsService.getAllSubscriptionsByTelegramId(userId);
    const additionalSubs = allSubs.filter((s) => s.isAdditional);

    if (additionalSubs.length === 0) {
      await this.maxApi.sendMessage(userId, BotMessages.noAdditionalSubscriptions, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '� Купить доп. подписку', callback_data: BotCallbacks.BuyAdditional }],
            [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
          ],
        },
      });
      return;
    }

    let text = BotMessages.additionalSubscriptions + '\n\n';
    for (const sub of additionalSubs) {
      const expireDate = await this.getExpireDate(sub);
      const typeLabel = sub.isAntiThrottling ? '🛡 Антиглушилка' : '📦 Базовый';
      text += `• ${typeLabel} — до ${expireDate}\n`;
    }

    await this.maxApi.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📎 Купить ещё', callback_data: BotCallbacks.BuyAdditional }],
          [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  // ─── Buy subscription ──────────────────────────────────────────────────

  private async showBuySubscriptionMenu(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.buySubscriptionTitle, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '� Базовый', callback_data: BotCallbacks.BuySubStd },
            { text: '🛡 Антиглушилка', callback_data: BotCallbacks.BuySubAnti },
          ],
          [{ text: '�️ Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  private async showBuySubStd(userId: string): Promise<void> {
    const plans = await this.plansService.findAll('standard');
    if (plans.length === 0) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const keyboard: any[][] = plans.map((plan: Plan) => [
      {
        text: `${plan.label} — ${plan.price} �`,
        callback_data: `period_${plan.id}`,
      },
    ]);

    keyboard.push([{ text: '�️ Назад', callback_data: BotCallbacks.BuySubscription }]);

    await this.maxApi.sendMessage(userId, BotMessages.selectPeriod, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showBuySubAnti(userId: string): Promise<void> {
    const plans = await this.plansService.findAll('anti-throttling');
    if (plans.length === 0) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const keyboard: any[][] = plans.map((plan: Plan) => [
      {
        text: `${plan.label} — ${plan.price} ₽`,
        callback_data: `period_${plan.id}`,
      },
    ]);

    keyboard.push([{ text: '⬅️ Назад', callback_data: BotCallbacks.BuySubscription }]);

    await this.maxApi.sendMessage(userId, BotMessages.selectPeriod, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // ─── Buy additional subscriptions ───────────────────────────────────────

  private async showBuyAdditionalMenu(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.buyAdditionalTitle, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '� Базовый (доп.)', callback_data: BotCallbacks.BuyAdditionalStd },
            { text: '🛡 Антиглушилка (доп.)', callback_data: BotCallbacks.BuyAdditionalAnti },
          ],
          [{ text: '⬅️ Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  private async showBuyAdditionalStd(userId: string): Promise<void> {
    const plans = await this.plansService.findAll('standard');
    const keyboard: any[][] = plans.map((plan: Plan) => [
      {
        text: `${plan.label} — ${plan.price} �`,
        callback_data: `period_${plan.id}_add`,
      },
    ]);

    keyboard.push([{ text: '⬅️ Назад', callback_data: BotCallbacks.BuyAdditional }]);

    await this.maxApi.sendMessage(userId, BotMessages.selectPeriod, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  private async showBuyAdditionalAnti(userId: string): Promise<void> {
    const plans = await this.plansService.findAll('anti-throttling');
    const keyboard: any[][] = plans.map((plan: Plan) => [
      {
        text: `${plan.label} — ${plan.price} ₽`,
        callback_data: `period_${plan.id}_add`,
      },
    ]);

    keyboard.push([{ text: '⬅️ Назад', callback_data: BotCallbacks.BuyAdditional }]);

    await this.maxApi.sendMessage(userId, BotMessages.selectPeriod, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  // ─── Period selection & payment flow ────────────────────────────────────

  /**
   * Handle period selection callback.
   * Format: period_{planId} or period_{planId}_add
   */
  private async handlePeriodSelection(userId: string, callbackData: string): Promise<void> {
    const parts = callbackData.split('_');
    const planId = parseInt(parts[1], 10);
    const isAdditional = parts[2] === 'add';

    const plan = await this.plansService.findOne(planId);
    if (!plan) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const periodLabel = this.getPeriodLabel(plan.months);
    const confirmText = this.interpolate(BotMessages.confirmPurchase, {
      plan: plan.label,
      period: periodLabel,
      price: plan.price.toString(),
    });

    await this.maxApi.sendMessage(userId, confirmText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '💳 Оплатить',
              callback_data: `confirm_${planId}_${isAdditional ? 'add' : 'main'}`,
            },
          ],
          [{ text: '�️ Назад', callback_data: isAdditional ? BotCallbacks.BuyAdditional : BotCallbacks.BuySubscription }],
        ],
      },
    });
  }

  /**
   * Handle payment confirmation – create payment session and generate FreeKassa link.
   * Format: confirm_{planId}_main or confirm_{planId}_add
   */
  private async handleConfirm(userId: string, callbackData: string): Promise<void> {
    const parts = callbackData.split('_');
    const planId = parseInt(parts[1], 10);
    const isAdditional = parts[2] === 'add';

    const plan = await this.plansService.findOne(planId);
    if (!plan) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    // Calculate days from months
    const days = plan.months * 30;

    // Create payment session
    const session = await this.paymentsService.createSession({
      telegramId: userId,
      period: plan.months,
      amount: plan.price,
      planMetadata: JSON.stringify({
        dataLimitGB: plan.dataLimitGB,
        planType: plan.planType,
        isAdditional,
      }),
    });

    // Generate FreeKassa payment URL
    let paymentUrl: string;
    try {
      const result = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId: userId,
      });

      // Save FK order ID for webhook matching
      await this.paymentsService.setFkOrderId(session.invId, result.fkOrderId);
      paymentUrl = result.url;
    } catch (error) {
      this.logger.error(`Failed to generate payment URL for user ${userId}:`, error);
      await this.maxApi.sendMessage(userId, BotMessages.paymentError, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const paymentText = this.interpolate(BotMessages.paymentLink, {});

    await this.maxApi.sendMessage(userId, paymentText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Перейти к оплате', url: paymentUrl }],
          [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  // ─── Device slots ──────────────────────────────────────────────────────

  private async showBuyDeviceSlots(userId: string): Promise<void> {
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(userId);
    if (!activeSub) {
      await this.maxApi.sendMessage(userId, BotMessages.noSubscriptions, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Купить подписку', callback_data: BotCallbacks.BuySubscription }],
            [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
          ],
        },
      });
      return;
    }

    const slotPlans = await this.deviceSlotPlansService.findActive();
    if (slotPlans.length === 0) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const keyboard: any[][] = slotPlans.map((plan: DeviceSlotPlan) => [
      {
        text: `${plan.label} — ${plan.price} ₽`,
        callback_data: `buy_slot_${plan.id}`,
      },
    ]);

    keyboard.push([{ text: '�️ Назад', callback_data: BotCallbacks.Menu }]);

    await this.maxApi.sendMessage(userId, BotMessages.buyDeviceSlotsTitle.replace('{{currentSlots}}', '5'), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  /**
   * Handle device slot selection.
   * Format: buy_slot_{planId}
   */
  private async handleDeviceSlotSelection(userId: string, callbackData: string): Promise<void> {
    const planId = parseInt(callbackData.replace('buy_slot_', ''), 10);
    const plan = await this.deviceSlotPlansService.findAll().then((plans) => plans.find((p) => p.id === planId));

    if (!plan) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    const confirmText = this.interpolate(BotMessages.deviceSlotsSelected, {
      count: plan.slotsCount.toString(),
      price: plan.price.toString(),
    });

    await this.maxApi.sendMessage(userId, confirmText, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '� Оплатить', callback_data: `confirm_slot_${plan.id}` }],
          [{ text: '�️ Назад', callback_data: BotCallbacks.BuyDeviceSlots }],
        ],
      },
    });
  }

  /**
   * Handle device slot payment confirmation.
   * Format: confirm_slot_{planId}
   */
  private async handleDeviceSlotConfirm(userId: string, callbackData: string): Promise<void> {
    const planId = parseInt(callbackData.replace('confirm_slot_', ''), 10);
    const plan = await this.deviceSlotPlansService.findAll().then((plans) => plans.find((p) => p.id === planId));

    if (!plan) {
      await this.maxApi.sendMessage(userId, BotMessages.error, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    // Create payment session for device slots
    const session = await this.paymentsService.createSession({
      telegramId: userId,
      period: 0,
      amount: plan.price,
      planMetadata: JSON.stringify({
        deviceSlots: plan.slotsCount,
        isDeviceSlot: true,
      }),
    });

    // Generate FreeKassa payment URL
    let paymentUrl: string;
    try {
      const result = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        telegramId: userId,
      });
      await this.paymentsService.setFkOrderId(session.invId, result.fkOrderId);
      paymentUrl = result.url;
    } catch (error) {
      this.logger.error(`Failed to generate payment URL for device slots, user ${userId}:`, error);
      await this.maxApi.sendMessage(userId, BotMessages.paymentError, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }]] },
      });
      return;
    }

    await this.maxApi.sendMessage(userId, BotMessages.paymentLink, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Перейти к оплате', url: paymentUrl }],
          [{ text: '🏠 Главное меню', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  // ─── Referral ──────────────────────────────────────────────────────────

  private async showReferral(userId: string): Promise<void> {
    const referralBaseUrl = this.configService.get<string>('max.referralBaseUrl') || '';
    const referralLink = `${referralBaseUrl}?start=ref_${userId}`;

    // Count referrals (subscriptions where this user is referrer)
    const referralSubs = await this.subscriptionRepo.find({
      where: { referrerId: userId },
    });

    const text = this.interpolate(BotMessages.referralTitle, {
      referralLink,
      referralCount: referralSubs.length.toString(),
    });

    await this.maxApi.sendMessage(userId, text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  // ─── Instructions ──────────────────────────────────────────────────────

  private async showInstructions(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.instructionsTitle, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '� Android', callback_data: 'instr_android' }],
          [{ text: '🍎 iOS', callback_data: 'instr_ios' }],
          [{ text: '� Windows', callback_data: 'instr_windows' }],
          [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  // ─── About ─────────────────────────────────────────────────────────────

  private async showAboutMenu(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.aboutMenuTitle, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '� Политика конфиденциальности', callback_data: BotCallbacks.PrivacyPolicy }],
          [{ text: '📋 Условия использования', callback_data: BotCallbacks.TermsOfService }],
          [{ text: '💬 Поддержка', callback_data: 'support' }],
          [{ text: '🏠 Назад', callback_data: BotCallbacks.Menu }],
        ],
      },
    });
  }

  private async showPrivacyPolicy(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.privacyPolicy, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '�️ Назад', callback_data: BotCallbacks.AboutMenu }]],
      },
    });
  }

  private async showTermsOfService(userId: string): Promise<void> {
    await this.maxApi.sendMessage(userId, BotMessages.termsOfService, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: BotCallbacks.AboutMenu }]],
      },
    });
  }

  // ─── Payment processing (called from FreeKassa webhook handler) ─────────

  /**
   * Process successful payment – create/extend subscription.
   * This method is called by the payment webhook handler.
   */
  async processSuccessfulPayment(session: {
    telegramId: string;
    invId: string;
    amount: number;
    period: number;
    planMetadata?: string;
    referrerId?: string;
  }): Promise<void> {
    const { telegramId, period, planMetadata, referrerId } = session;

    let metadata: any = {};
    if (planMetadata) {
      try {
        metadata = JSON.parse(planMetadata);
      } catch {
        this.logger.warn(`Invalid planMetadata for ${telegramId}: ${planMetadata}`);
      }
    }

    // Device slots purchase
    if (metadata.isDeviceSlot && metadata.deviceSlots) {
      await this.processDeviceSlotPurchase(telegramId, metadata.deviceSlots);
      return;
    }

    const isAdditional = metadata.isAdditional === true;
    const dataLimitGB = metadata.dataLimitGB || 0;

    let subscriptionId: string | undefined;
    let subPageUrl: string | null = null;

    if (isAdditional) {
      // Create additional subscription
      const result = await this.subscriptionsService.createSubscription({
        telegramId,
        days: period * 30,
        source: SubscriptionSource.BOT,
        dataLimitGB,
        isAdditional: true,
        referrerId,
      });
      subscriptionId = result.subscriptionId;
      subPageUrl = result.subPageUrl;
    } else {
      // Check for existing active subscription
      const existing = await this.subscriptionsService.getActiveSubscriptionByTelegramId(telegramId);
      if (existing) {
        // Extend existing
        await this.subscriptionsService.extendSubscription(existing.id, period * 30, dataLimitGB);
        subscriptionId = existing.id;
        subPageUrl = await this.subscriptionsService.getSubPageUrl(existing.id);
      } else {
        // Create new
        const result = await this.subscriptionsService.createSubscription({
          telegramId,
          days: period * 30,
          source: SubscriptionSource.BOT,
          dataLimitGB,
          referrerId,
        });
        subscriptionId = result.subscriptionId;
        subPageUrl = result.subPageUrl;
      }
    }

    // Notify user
    await this.paymentNotificationService.notifyPaymentSuccess(
      telegramId,
      subPageUrl || '',
      period,
      dataLimitGB > 0,
      subPageUrl,
    );

    // Reward referrer if applicable
    if (referrerId) {
      await this.referralService.rewardReferrer(referrerId);
    }
  }

  /**
   * Process device slot purchase.
   */
  private async processDeviceSlotPurchase(userId: string, slotsCount: number): Promise<void> {
    const activeSub = await this.subscriptionsService.getActiveSubscriptionByTelegramId(userId);
    if (!activeSub || !activeSub.remnawaveUuid) {
      this.logger.warn(`No active subscription for device slot purchase: ${userId}`);
      return;
    }

    // Get current HWID limit from Remnawave and add slots
    const currentLimit = 5; // Default base limit
    const newLimit = currentLimit + slotsCount;

    await this.subscriptionsService.updateHwidDeviceLimit(activeSub.id, newLimit);

    await this.paymentNotificationService.notifyDeviceSlotsSuccess(userId, slotsCount, newLimit);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  /**
   * Extract user_id from webhook update.
   */
  private extractUserId(update: any): string | null {
    // MAX API sends user_id in different places depending on update type
    return (
      update.message?.user?.id?.toString() ||
      update.callback?.user?.id?.toString() ||
      update.bot_started?.user?.id?.toString() ||
      null
    );
  }

  /**
   * Parse referral parameter from /start command.
   */
  private parseReferralParam(param: string): string | null {
    if (param.startsWith('ref_')) {
      return param.replace('ref_', '');
    }
    return null;
  }

  /**
   * Store referral information for new user.
   */
  private async storeReferral(userId: string, referrerId: string): Promise<void> {
    // Check if user already has any subscriptions
    const existingSubs = await this.subscriptionsService.getAllSubscriptionsByTelegramId(userId);
    if (existingSubs.length > 0) {
      return; // User already has subscription, don't store referral
    }

    // Store referrer in session or temporary storage
    // For simplicity, we'll use a simple in-memory approach or just pass it when creating subscription
    // In production, you might want a separate referral tracking table
    this.logger.log(`Referral stored: ${userId} referred by ${referrerId}`);
  }

  /**
   * Calculate days left for subscription.
   */
  private async calculateDaysLeft(subscription: Subscription): Promise<number> {
    const enriched = await this.subscriptionsService.getRemnawaveUser(subscription.id);
    if (!enriched?.expireAt) return 0;

    const expireDate = new Date(enriched.expireAt);
    const now = new Date();
    const diffMs = expireDate.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }

  /**
   * Get formatted expire date string.
   */
  private async getExpireDate(subscription: Subscription): Promise<string> {
    const enriched = await this.subscriptionsService.getRemnawaveUser(subscription.id);
    if (!enriched?.expireAt) return 'неизвестно';

    const date = new Date(enriched.expireAt);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * Get period label for display.
   */
  private getPeriodLabel(months: number): string {
    if (months === 1) return '1 месяц';
    if (months >= 2 && months <= 4) return `${months} месяца`;
    return `${months} месяцев`;
  }

  /**
   * Simple template interpolation: {{key}} → value
   */
  private interpolate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }
}
