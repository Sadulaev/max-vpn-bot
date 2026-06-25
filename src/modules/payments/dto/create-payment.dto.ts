export interface CreatePaymentDto {
  telegramId: string;
  firstName?: string;
  username?: string;
  period: number;
  amount: number;
  ttlMinutes?: number;
  /** ID подписки в нашей БД (для продления конкретной подписки из mini app) */
  subscriptionId?: string;
  /** Создать новую подписку (не продлевать активную) — для mini app */
  forceNewSubscription?: boolean;
  /** Telegram ID реферера */
  referrerId?: string;
  /** Метаданные плана (JSON string) */
  planMetadata?: string;
}

