import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MaxApiService } from '@modules/max-api';
import type { MaxUpdate, MaxBotStartedUpdate, MaxMessageCreatedUpdate, MaxMessageCallbackUpdate } from '@modules/max-api';
import { BotPagesService } from '@modules/bot-pages';
import { PlansService } from '@modules/plans';
import { PaymentsService } from '@modules/payments';
import { FreekassaService } from '@modules/payments';
import { SubscriptionsService } from '@modules/subscriptions';
import { SubscriptionSource } from '@database/entities';

/** Хранит реферер для нового пользователя до момента покупки */
const pendingReferrals = new Map<string, string>(); // userId → referrerId

@Injectable()
export class MaxBotService implements OnModuleInit {
  private readonly logger = new Logger(MaxBotService.name);
  /** Токен баннерного изображения, закешированный при старте */
  private cachedImageToken: string | null = null;
  /** Токен изображения страницы инструкций */
  private cachedInstructionsImageToken: string | null = null;

  constructor(
    private readonly maxApi: MaxApiService,
    private readonly pages: BotPagesService,
    private readonly plansService: PlansService,
    private readonly paymentsService: PaymentsService,
    private readonly freekassaService: FreekassaService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const baseUrl = this.configService.get<string>('app.baseUrl', '');
    const webhookSecret = this.configService.get<string>('max.webhookSecret', '');

    if (!this.maxApi.isConfigured()) {
      this.logger.warn('MaxApiService not configured — skipping webhook registration');
      return;
    }

    // Регистрируем webhook
    if (baseUrl) {
      const webhookUrl = `${baseUrl.replace(/\/$/, '')}/max/webhook`;
      this.logger.log(`Registering MAX webhook: ${webhookUrl}`);
      const ok = await this.maxApi.registerWebhook(webhookUrl, webhookSecret || undefined);
      if (ok) {
        this.logger.log('MAX webhook registered successfully');
      } else {
        this.logger.warn('MAX webhook registration returned failure (check URL/token)');
      }
    } else {
      this.logger.warn('BASE_URL not set — skipping webhook registration');
    }

    // Загружаем баннерное изображение
    await this.warmUpBannerImage();
    await this.warmUpInstructionsImage();
  }

  /** Загружает assets/menu-page.jpg и кеширует токен */
  private async warmUpBannerImage(): Promise<void> {
    const imagePath = join(process.cwd(), 'assets', 'menu-page.jpg');

    if (!existsSync(imagePath)) {
      this.logger.warn(`Banner image not found at ${imagePath} — messages will be sent without image`);
      return;
    }

    try {
      const buffer = readFileSync(imagePath);
      this.logger.log('Uploading banner image to MAX API...');
      const token = await this.maxApi.uploadImage(buffer, 'menu-page.jpg');

      if (token) {
        this.cachedImageToken = token;
        this.logger.log('Banner image uploaded and token cached');
      } else {
        this.logger.warn('Banner image upload returned no token — messages will be sent without image');
      }
    } catch (err: unknown) {
      this.logger.error(`Failed to upload banner image: ${(err as Error)?.message}`);
    }
  }

  /** Загружает assets/instructions-page.jpg и кеширует токен */
  private async warmUpInstructionsImage(): Promise<void> {
    const imagePath = join(process.cwd(), 'assets', 'instructions-page.jpg');

    if (!existsSync(imagePath)) {
      this.logger.warn(`Instructions image not found at ${imagePath} — instruction page will be sent without image`);
      return;
    }

    try {
      const buffer = readFileSync(imagePath);
      this.logger.log('Uploading instructions image to MAX API...');
      const token = await this.maxApi.uploadImage(buffer, 'instructions-page.jpg');

      if (token) {
        this.cachedInstructionsImageToken = token;
        this.logger.log('Instructions image uploaded and token cached');
      } else {
        this.logger.warn('Instructions image upload returned no token — instruction page will be sent without image');
      }
    } catch (err: unknown) {
      this.logger.error(`Failed to upload instructions image: ${(err as Error)?.message}`);
    }
  }

  // ─── Dispatcher ───

  async handleUpdate(update: MaxUpdate): Promise<void> {
    try {
      switch (update.update_type) {
        case 'bot_started':
          await this.onBotStarted(update as MaxBotStartedUpdate);
          break;
        case 'message_created':
          await this.onMessageCreated(update as MaxMessageCreatedUpdate);
          break;
        case 'message_callback':
          await this.onMessageCallback(update as MaxMessageCallbackUpdate);
          break;
        default:
          this.logger.debug(`Unhandled update_type: ${update.update_type}`);
      }
    } catch (err: unknown) {
      this.logger.error(`Error handling update ${update.update_type}: ${(err as Error)?.message}`);
    }
  }

  // ─── bot_started ───

  private async onBotStarted(update: MaxBotStartedUpdate): Promise<void> {
    const userId = update.user.user_id;
    const userName = update.user.name;

    // Разбираем deep-link payload (формат: "ref_12345")
    if (update.payload?.startsWith('ref_')) {
      const referrerId = update.payload.slice(4);
      if (referrerId && referrerId !== String(userId)) {
        pendingReferrals.set(String(userId), referrerId);
        this.logger.log(`User ${userId} started via referral from ${referrerId}`);
      }
    }

    const body = this.pages.buildMainMenu(userId, userName, this.cachedImageToken);
    await this.maxApi.sendMessage(userId, body);
  }

  // ─── message_created ───

  private async onMessageCreated(update: MaxMessageCreatedUpdate): Promise<void> {
    const msg = update.message;
    // Только личные сообщения боту
    if (!msg.sender) return;

    const userId = msg.sender.user_id;
    const text = (msg.body?.text ?? '').trim();

    if (text === '/start' || text === 'start' || text === 'Начать') {
      const body = this.pages.buildMainMenu(userId, msg.sender.name, this.cachedImageToken);
      await this.maxApi.sendMessage(userId, body);
      return;
    }

    // Любое другое сообщение → главное меню
    const body = this.pages.buildMainMenu(userId, msg.sender.name, this.cachedImageToken);
    await this.maxApi.sendMessage(userId, body);
  }

  // ─── message_callback ───

  private async onMessageCallback(update: MaxMessageCallbackUpdate): Promise<void> {
    const { callback } = update;
    const userId = callback.user.user_id;
    const payload = callback.payload ?? '';

    // Сразу подтверждаем нажатие
    await this.maxApi.answerCallback(callback.callback_id);

    if (payload === 'main_menu') {
      await this.showMainMenu(userId, callback.user.name);
      return;
    }

    if (payload === 'buy_sub') {
      await this.showPlans(userId);
      return;
    }

    if (payload.startsWith('plan:')) {
      const planId = parseInt(payload.split(':')[1], 10);
      await this.handlePlanSelected(userId, planId);
      return;
    }

    if (payload === 'my_sub') {
      await this.showMySubscription(userId);
      return;
    }

    if (payload === 'instruction') {
      await this.showInstruction(userId);
      return;
    }

    if (payload.startsWith('instruction:')) {
      const device = payload.split(':')[1];
      await this.showInstructionDevice(userId, device);
      return;
    }

    if (payload === 'referral') {
      await this.showReferral(userId);
      return;
    }

    if (payload === 'support') {
      await this.showSupport(userId);
      return;
    }

    // Неизвестный payload — возвращаем главное меню
    await this.showMainMenu(userId, callback.user.name);
  }

  // ─── Handlers ───

  private async showMainMenu(userId: number, userName?: string): Promise<void> {
    const body = this.pages.buildMainMenu(userId, userName, this.cachedImageToken);
    await this.maxApi.sendMessage(userId, body);
  }

  private async showPlans(userId: number): Promise<void> {
    const body = await this.pages.buildPlansPage();
    await this.maxApi.sendMessage(userId, body);
  }

  private async showMySubscription(userId: number): Promise<void> {
    const body = await this.pages.buildMySubscriptionPage(userId);
    await this.maxApi.sendMessage(userId, body);
  }

  private async showInstruction(userId: number): Promise<void> {
    const body = await this.pages.buildInstructionPage(userId, this.cachedInstructionsImageToken);
    await this.maxApi.sendMessage(userId, body);
  }

  private async showInstructionDevice(userId: number, device: string): Promise<void> {
    const body = await this.pages.buildInstructionDevicePage(userId, device);
    await this.maxApi.sendMessage(userId, body);
  }

  private async showReferral(userId: number): Promise<void> {
    const body = this.pages.buildReferralPage(userId);
    await this.maxApi.sendMessage(userId, body);
  }

  private async showSupport(userId: number): Promise<void> {
    const body = this.pages.buildSupportPage();
    await this.maxApi.sendMessage(userId, body);
  }

  private async handlePlanSelected(userId: number, planId: number): Promise<void> {
    let plan;
    try {
      plan = await this.plansService.findOne(planId);
    } catch {
      await this.maxApi.sendMessage(userId, {
        text: '❌ Тариф не найден. Попробуйте ещё раз.',
      });
      return;
    }

    const referrerId = pendingReferrals.get(String(userId)) ?? null;
    const days = plan.months * 30;

    try {
      // Создаём платёжную сессию
      const session = await this.paymentsService.createSession({
        maxId: String(userId),
        period: plan.months,
        amount: plan.price,
        ttlMinutes: 60,
        referrerId: referrerId ?? undefined,
        planMetadata: JSON.stringify({
          planId: plan.id,
          planLabel: plan.label,
          dataLimitGB: plan.dataLimitGB,
          planType: plan.planType,
          days,
        }),
      });

      // Генерируем URL оплаты
      const paymentResult = await this.freekassaService.generatePaymentUrl({
        invId: session.invId,
        amount: plan.price,
        maxId: String(userId),
      });

      // Сохраняем FK orderId в сессии
      await this.paymentsService.setFkOrderId(session.invId, paymentResult.fkOrderId);

      const body = this.pages.buildPaymentPage(plan.label, plan.price, paymentResult.url);
      await this.maxApi.sendMessage(userId, body);
    } catch (err: unknown) {
      this.logger.error(`handlePlanSelected error for userId=${userId}, planId=${planId}: ${(err as Error)?.message}`);
      await this.maxApi.sendMessage(userId, {
        text: '❌ Ошибка при создании платежа. Попробуйте позже или обратитесь в поддержку.',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [{ type: 'callback', text: '🛟 Поддержка', payload: 'support' }],
                [{ type: 'callback', text: '◀️ Назад', payload: 'buy_sub' }],
              ],
            },
          },
        ],
      });
    }
  }

  // ─── Public API для PaymentNotificationService ───

  async sendPaymentSuccess(
    maxId: string,
    planLabel: string,
    subscriptionUrl: string | null,
    subPageUrl: string | null,
  ): Promise<void> {
    const userId = parseInt(maxId, 10);
    if (isNaN(userId)) return;

    // Удаляем реферала после оплаты
    pendingReferrals.delete(maxId);

    const body = this.pages.buildPaymentSuccessPage(planLabel, subPageUrl, subscriptionUrl);
    await this.maxApi.sendMessage(userId, body);
  }

  async sendKeyGenerationError(maxId: string): Promise<void> {
    const userId = parseInt(maxId, 10);
    if (isNaN(userId)) return;

    const body = this.pages.buildKeyErrorPage();
    await this.maxApi.sendMessage(userId, body);
  }

  async sendReferralBonus(referrerId: string, days: number): Promise<void> {
    const userId = parseInt(referrerId, 10);
    if (isNaN(userId)) return;

    // Пробуем получить subPageUrl реферера
    let subPageUrl: string | null = null;
    try {
      const sub = await this.subscriptionsService.getActiveSubscriptionByMaxId(referrerId);
      if (sub) {
        subPageUrl = await this.subscriptionsService.getSubPageUrl(sub.id);
      }
    } catch {
      subPageUrl = null;
    }

    const body = this.pages.buildReferralBonusNotification(days, subPageUrl ?? undefined);
    await this.maxApi.sendMessage(userId, body);
  }

  getPendingReferral(userId: string): string | null {
    return pendingReferrals.get(userId) ?? null;
  }
}
