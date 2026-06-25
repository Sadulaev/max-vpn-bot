/**
 * Колбэки для пользовательского бота
 */
export enum BotCallbacks {
  // Навигация
  Menu = 'menu',

  // Подписки
  MySubscription = 'my_subscription',
  MyAdditionalSubscriptions = 'my_add_subs',

  // Покупка подписки
  BuySubscription = 'buy_subscription',
  BuySubStd = 'buy_sub_std',
  BuySubAnti = 'buy_sub_anti',

  // Покупка дополнительных подписок
  BuyAdditional = 'buy_add',
  BuyAdditionalStd = 'buy_add_std',
  BuyAdditionalAnti = 'buy_add_anti',

  // Покупка слотов устройств
  BuyDeviceSlots = 'buy_dev_slots',

  // Реферальная система
  Referral = 'referral',

  // Инструкция
  Instructions = 'instructions',

  // О сервисе
  AboutMenu = 'about_menu',
  PrivacyPolicy = 'about_privacy',
  TermsOfService = 'about_terms',
}

