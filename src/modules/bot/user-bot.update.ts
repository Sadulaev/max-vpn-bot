import { Update, Start, Action, Ctx, Command, On } from 'nestjs-telegraf';
import { UserBotService } from './services/user-bot.service';
import { BotCallbacks } from './constants/callbacks';
import { MessageContext, CallbackContext } from './types/context';

@Update()
export class UserBotUpdate {
  constructor(private readonly botService: UserBotService) {}

  @Start()
  async onStart(@Ctx() ctx: MessageContext): Promise<void> {
    await this.botService.handleStart(ctx);
  }

  @Command('menu')
  async onMenu(@Ctx() ctx: MessageContext): Promise<void> {
    await this.botService.sendMainMenu(ctx);
  }

  @Action(BotCallbacks.Menu)
  async onMenuCallback(@Ctx() ctx: CallbackContext): Promise<void> {
    await ctx.answerCbQuery();
    try { await ctx.deleteMessage(); } catch {}
    await this.botService.sendMainMenu(ctx);
  }

  // ─── Подписки ───

  @Action(BotCallbacks.MySubscription)
  async onMySubscription(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showMySubscription(ctx);
  }

  @Action(BotCallbacks.MyAdditionalSubscriptions)
  async onMyAdditionalSubscriptions(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showAdditionalSubscriptions(ctx, 0);
  }

  @Action(/^add_subs_page_\d+$/)
  async onAddSubsPage(@Ctx() ctx: CallbackContext): Promise<void> {
    const page = parseInt(ctx.callbackQuery.data.replace('add_subs_page_', ''), 10);
    await this.botService.showAdditionalSubscriptions(ctx, page);
  }

  @Action(/^sub_detail_/)
  async onSubDetail(@Ctx() ctx: CallbackContext): Promise<void> {
    const subId = ctx.callbackQuery.data.replace('sub_detail_', '');
    await this.botService.showSubDetail(ctx, subId);
  }

  @Action(/^sub_del_confirm_/)
  async onSubDelConfirm(@Ctx() ctx: CallbackContext): Promise<void> {
    const subId = ctx.callbackQuery.data.replace('sub_del_confirm_', '');
    await this.botService.confirmDeleteSub(ctx, subId);
  }

  @Action(/^sub_delete_/)
  async onSubDelete(@Ctx() ctx: CallbackContext): Promise<void> {
    const subId = ctx.callbackQuery.data.replace('sub_delete_', '');
    await this.botService.handleDeleteSub(ctx, subId);
  }

  @Action(/^sub_devices_/)
  async onSubDevices(@Ctx() ctx: CallbackContext): Promise<void> {
    const subId = ctx.callbackQuery.data.replace('sub_devices_', '');
    await this.botService.showSubDevices(ctx, subId);
  }

  @Action(/^sub_dev_del_/)
  async onSubDevDelete(@Ctx() ctx: CallbackContext): Promise<void> {
    const parts = ctx.callbackQuery.data.replace('sub_dev_del_', '').split('_');
    // format: sub_dev_del_{subId}_{index}
    // subId is UUID (contains hyphens), index is last part
    const index = parseInt(parts[parts.length - 1], 10);
    const subId = parts.slice(0, parts.length - 1).join('_');
    await this.botService.handleDeleteDevice(ctx, subId, index);
  }

  // ─── Покупка дополнительных подписок ───

  @Action(BotCallbacks.BuyAdditional)
  async onBuyAdditional(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuyAdditionalPlans(ctx);
  }

  @Action(BotCallbacks.BuyAdditionalStd)
  async onBuyAdditionalStd(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuyAdditionalPlansByType(ctx, false);
  }

  @Action(BotCallbacks.BuyAdditionalAnti)
  async onBuyAdditionalAnti(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuyAdditionalPlansByType(ctx, true);
  }

  @Action(/^buy_plan_add_\d+$/)
  async onBuyPlanAdditional(@Ctx() ctx: CallbackContext): Promise<void> {
    const planId = parseInt(ctx.callbackQuery.data.replace('buy_plan_add_', ''), 10);
    await this.botService.handleBuyAdditionalPlan(ctx, planId);
  }

  // ─── Покупка подписки (новый флоу) ───

  @Action(BotCallbacks.BuySubscription)
  async onBuySubscription(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuySubscription(ctx);
  }

  @Action(BotCallbacks.BuySubStd)
  async onBuySubStd(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuySubStd(ctx);
  }

  @Action(BotCallbacks.BuySubAnti)
  async onBuySubAnti(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showBuySubAnti(ctx);
  }

  @Action(/^buy_main_plan_\d+$/)
  async onBuyMainPlan(@Ctx() ctx: CallbackContext): Promise<void> {
    const planId = parseInt(ctx.callbackQuery.data.replace('buy_main_plan_', ''), 10);
    await this.botService.handleBuyMainPlan(ctx, planId);
  }

  // ─── Слоты устройств ───

  @Action(/^buy_dev_slots_/)
  async onBuyDeviceSlots(@Ctx() ctx: CallbackContext): Promise<void> {
    const subId = ctx.callbackQuery.data.replace('buy_dev_slots_', '');
    await this.botService.showBuyDeviceSlots(ctx, subId);
  }

  @Action(/^buy_dev_slot_plan_\d+$/)
  async onBuyDeviceSlotPlan(@Ctx() ctx: CallbackContext): Promise<void> {
    const planId = parseInt(ctx.callbackQuery.data.replace('buy_dev_slot_plan_', ''), 10);
    await this.botService.handleBuyDeviceSlotPlan(ctx, planId);
  }

  // ─── Продление ───

  @Action(/^renew_sub_/)
  async onRenewSubSelected(@Ctx() ctx: CallbackContext): Promise<void> {
    const subscriptionId = ctx.callbackQuery.data.replace('renew_sub_', '');
    await this.botService.handleRenewSubSelected(ctx, subscriptionId);
  }

  @Action(/^renew_plan_\d+$/)
  async onRenewPlan(@Ctx() ctx: CallbackContext): Promise<void> {
    const idx = parseInt(ctx.callbackQuery.data.replace('renew_plan_', ''), 10);
    await this.botService.handleRenewPlan(ctx, idx);
  }

  // ─── Прочее ───

  @Action(BotCallbacks.Referral)
  async onReferral(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showReferral(ctx);
  }

  // ─── О сервисе ───

  @Action(BotCallbacks.Instructions)
  async onInstructions(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showInstructions(ctx);
  }

  @Action(BotCallbacks.AboutMenu)
  async onAboutMenu(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showAboutMenu(ctx);
  }

  @Action(BotCallbacks.PrivacyPolicy)
  async onPrivacyPolicy(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showPrivacyPolicy(ctx);
  }

  @Action(BotCallbacks.TermsOfService)
  async onTermsOfService(@Ctx() ctx: CallbackContext): Promise<void> {
    await this.botService.showTermsOfService(ctx);
  }

  // ─── Текстовый ввод (для ожидания данных от пользователя) ───

  @On('text')
  async onText(@Ctx() ctx: MessageContext): Promise<void> {
    if (ctx.session.status === 'awaiting_add_sub_name') {
      await this.botService.handleAdditionalSubNameInput(ctx);
    }
  }
}


