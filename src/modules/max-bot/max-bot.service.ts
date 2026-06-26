import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { UserBotService } from '@modules/bot';
import { BotCallbacks } from '@modules/bot';
import { MaxApiService } from '@modules/max-api';

type SessionData = Record<string, any>;

@Injectable()
export class MaxBotService implements OnModuleInit {
  private readonly logger = new Logger(MaxBotService.name);
  private readonly sessionFilePath = join(process.cwd(), 'sessions', 'max_bot.json');
  private readonly sessions = new Map<string, SessionData>();
  private sessionsLoaded = false;

  constructor(
    private readonly userBotService: UserBotService,
    private readonly maxApiService: MaxApiService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadSessions();
    await this.maxApiService.ensureWebhook().catch((error) => {
      this.logger.warn(`MAX webhook registration skipped: ${(error as Error).message}`);
      console.log(error);
    });
  }

  async handleUpdate(update: any): Promise<void> {
    const updateType = update?.update_type;

    if (updateType === 'bot_started') {
      const userId = update?.user?.user_id?.toString();
      if (!userId) {
        return;
      }
      const ctx = await this.createMessageContext(userId, '/start', update, undefined);
      await this.userBotService.handleStart(ctx as any);
      await this.saveSession(userId, ctx.session);
      return;
    }

    if (updateType === 'message_created') {
      await this.handleMessageCreated(update);
      return;
    }

    if (updateType === 'message_callback') {
      await this.handleMessageCallback(update);
    }
  }

  private async handleMessageCreated(update: any): Promise<void> {
    const userId = update?.message?.sender?.user_id?.toString();
    const text = update?.message?.body?.text ?? '';
    if (!userId) {
      return;
    }

    const ctx = await this.createMessageContext(userId, text, update, update?.message?.body?.mid);

    const trimmedText = String(text || '').trim();
    if (/^\/start(?:\s+.+)?$/i.test(trimmedText)) {
      await this.userBotService.handleStart(ctx as any);
    } else if (/^\/menu$/i.test(trimmedText)) {
      await this.userBotService.sendMainMenu(ctx as any);
    } else if (ctx.session.status === 'awaiting_add_sub_name') {
      await this.userBotService.handleAdditionalSubNameInput(ctx as any);
    } else if (this.isReferralCode(trimmedText) && trimmedText !== userId) {
      ctx.session.referrerId = trimmedText;
      await this.userBotService.handleStart(ctx as any);
    } else {
      await this.userBotService.sendMainMenu(ctx as any);
    }

    await this.saveSession(userId, ctx.session);
  }

  private async handleMessageCallback(update: any): Promise<void> {
    const userId = update?.callback?.user?.user_id?.toString();
    const payload = update?.callback?.payload ?? '';
    const callbackId = update?.callback?.callback_id;
    const messageId = update?.message?.body?.mid;

    if (!userId || !payload) {
      return;
    }

    const ctx = await this.createCallbackContext(userId, payload, callbackId, update, messageId);
    const handled = await this.dispatchCallback(ctx as any, payload);

    if (!handled) {
      await this.maxApiService.answerCallback(callbackId, 'Команда не распознана');
    }

    await this.saveSession(userId, ctx.session);
  }

  private async dispatchCallback(ctx: any, payload: string): Promise<boolean> {
    switch (payload) {
      case BotCallbacks.Menu:
        await ctx.answerCbQuery();
        try { await ctx.deleteMessage(); } catch {}
        await this.userBotService.sendMainMenu(ctx);
        return true;
      case BotCallbacks.MySubscription:
        await this.userBotService.showMySubscription(ctx);
        return true;
      case BotCallbacks.MyAdditionalSubscriptions:
        await this.userBotService.showAdditionalSubscriptions(ctx, 0);
        return true;
      case BotCallbacks.BuyAdditional:
        await this.userBotService.showBuyAdditionalPlans(ctx);
        return true;
      case BotCallbacks.BuyAdditionalStd:
        await this.userBotService.showBuyAdditionalPlansByType(ctx, false);
        return true;
      case BotCallbacks.BuyAdditionalAnti:
        await this.userBotService.showBuyAdditionalPlansByType(ctx, true);
        return true;
      case BotCallbacks.BuySubscription:
        await this.userBotService.showBuySubscription(ctx);
        return true;
      case BotCallbacks.BuySubStd:
        await this.userBotService.showBuySubStd(ctx);
        return true;
      case BotCallbacks.BuySubAnti:
        await this.userBotService.showBuySubAnti(ctx);
        return true;
      case BotCallbacks.Referral:
        await this.userBotService.showReferral(ctx);
        return true;
      case BotCallbacks.Instructions:
        await this.userBotService.showInstructions(ctx);
        return true;
      case BotCallbacks.AboutMenu:
        await this.userBotService.showAboutMenu(ctx);
        return true;
      case BotCallbacks.PrivacyPolicy:
        await this.userBotService.showPrivacyPolicy(ctx);
        return true;
      case BotCallbacks.TermsOfService:
        await this.userBotService.showTermsOfService(ctx);
        return true;
      default:
        break;
    }

    if (/^add_subs_page_\d+$/.test(payload)) {
      await this.userBotService.showAdditionalSubscriptions(ctx, parseInt(payload.replace('add_subs_page_', ''), 10));
      return true;
    }
    if (/^sub_detail_/.test(payload)) {
      await this.userBotService.showSubDetail(ctx, payload.replace('sub_detail_', ''));
      return true;
    }
    if (/^sub_del_confirm_/.test(payload)) {
      await this.userBotService.confirmDeleteSub(ctx, payload.replace('sub_del_confirm_', ''));
      return true;
    }
    if (/^sub_delete_/.test(payload)) {
      await this.userBotService.handleDeleteSub(ctx, payload.replace('sub_delete_', ''));
      return true;
    }
    if (/^sub_devices_/.test(payload)) {
      await this.userBotService.showSubDevices(ctx, payload.replace('sub_devices_', ''));
      return true;
    }
    if (/^sub_dev_del_/.test(payload)) {
      const parts = payload.replace('sub_dev_del_', '').split('_');
      const index = parseInt(parts[parts.length - 1], 10);
      const subId = parts.slice(0, parts.length - 1).join('_');
      await this.userBotService.handleDeleteDevice(ctx, subId, index);
      return true;
    }
    if (/^buy_plan_add_\d+$/.test(payload)) {
      await this.userBotService.handleBuyAdditionalPlan(ctx, parseInt(payload.replace('buy_plan_add_', ''), 10));
      return true;
    }
    if (/^buy_main_plan_\d+$/.test(payload)) {
      await this.userBotService.handleBuyMainPlan(ctx, parseInt(payload.replace('buy_main_plan_', ''), 10));
      return true;
    }
    if (/^buy_dev_slots_/.test(payload)) {
      await this.userBotService.showBuyDeviceSlots(ctx, payload.replace('buy_dev_slots_', ''));
      return true;
    }
    if (/^buy_dev_slot_plan_\d+$/.test(payload)) {
      await this.userBotService.handleBuyDeviceSlotPlan(ctx, parseInt(payload.replace('buy_dev_slot_plan_', ''), 10));
      return true;
    }
    if (/^renew_sub_/.test(payload)) {
      await this.userBotService.handleRenewSubSelected(ctx, payload.replace('renew_sub_', ''));
      return true;
    }
    if (/^renew_plan_\d+$/.test(payload)) {
      await this.userBotService.handleRenewPlan(ctx, parseInt(payload.replace('renew_plan_', ''), 10));
      return true;
    }

    return false;
  }

  private async createMessageContext(userId: string, text: string, update: any, messageId?: string): Promise<any> {
    const session = await this.getSession(userId);
    return {
      session,
      update,
      message: {
        text,
        from: {
          id: Number(userId),
        },
      },
      reply: (messageText: string, options?: any) => this.maxApiService.sendMessage(userId, messageText, options),
      replyWithPhoto: (photo: any, options?: any) => this.maxApiService.sendPhoto(userId, photo, options),
      answerCbQuery: (notification?: string) => notification ? Promise.resolve() : Promise.resolve(),
      deleteMessage: () => messageId ? this.maxApiService.deleteMessage(messageId) : Promise.resolve(),
    };
  }

  private async createCallbackContext(
    userId: string,
    payload: string,
    callbackId: string,
    update: any,
    messageId?: string,
  ): Promise<any> {
    const session = await this.getSession(userId);
    return {
      session,
      update,
      callbackQuery: {
        id: callbackId,
        data: payload,
        from: {
          id: Number(userId),
        },
      },
      reply: (messageText: string, options?: any) => this.maxApiService.sendMessage(userId, messageText, options),
      replyWithPhoto: (photo: any, options?: any) => this.maxApiService.sendPhoto(userId, photo, options),
      answerCbQuery: (notification?: string) => this.maxApiService.answerCallback(callbackId, notification),
      deleteMessage: () => messageId ? this.maxApiService.deleteMessage(messageId) : Promise.resolve(),
    };
  }

  private isReferralCode(text: string): boolean {
    return /^\d{5,}$/.test(text);
  }

  private async loadSessions(): Promise<void> {
    if (this.sessionsLoaded) {
      return;
    }

    this.sessionsLoaded = true;
    try {
      const raw = await readFile(this.sessionFilePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, SessionData>;
      for (const [key, value] of Object.entries(parsed)) {
        this.sessions.set(key, value || {});
      }
    } catch {
      return;
    }
  }

  private async getSession(userId: string): Promise<SessionData> {
    await this.loadSessions();
    const existing = this.sessions.get(userId);
    if (existing) {
      return existing;
    }

    const created: SessionData = {};
    this.sessions.set(userId, created);
    return created;
  }

  private async saveSession(userId: string, session: SessionData): Promise<void> {
    this.sessions.set(userId, session || {});
    await mkdir(dirname(this.sessionFilePath), { recursive: true });
    await writeFile(
      this.sessionFilePath,
      JSON.stringify(Object.fromEntries(this.sessions.entries()), null, 2),
      'utf8',
    );
  }
}