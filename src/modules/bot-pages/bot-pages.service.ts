import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NewMessageBody, MaxButtonRow, MaxAttachment } from '@modules/max-api';
import { PlansService } from '@modules/plans';
import { SubscriptionsService } from '@modules/subscriptions';

/** Константы текстов */
const MAIN_TEXT = `🚀 **HIT VPN** — свобода интернета без ограничений\n\n` +
  `✨ **Почему выбирают нас:**\n\n` +
  `⚡ Молниеносная скорость\n` +
  `🌐 Самые быстрые серверы\n` +
  `🔒 Стабильное соединение\n` +
  `🚫 Без рекламы\n` +
  `🛡 Полная анонимность и защита данных\n\n` +
  `📱 **Работает идеально для:**\n` +
  `WhatsApp • Telegram • Instagram • TikTok\n` +
  `📺 YouTube • Netflix — без задержек и ограничений`;

@Injectable()
export class BotPagesService {
  private supportContact: string;
  private channelLink: string;
  private referralBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    this.supportContact = this.configService.get<string>('bot.supportContact', '');
    this.channelLink = this.configService.get<string>('bot.channelLink', '');
    this.referralBaseUrl = this.configService.get<string>('max.referralBaseUrl', '');
  }

  /** Главное меню */
  buildMainMenu(userId: number, userName?: string, imageToken?: string | null): NewMessageBody {
    const greeting = userName ? `👋 Привет, **${userName}**!\n\n` : '';
    const text = `${greeting}${MAIN_TEXT}\n\n🆔 Ваш ID: \`${userId}\``;

    const buttons: MaxButtonRow[] = [
      [{ type: 'callback', text: '— Приобрести подписку —', payload: 'buy_sub' }],
      [{ type: 'callback', text: '💎 Моя подписка', payload: 'my_sub' }],
      [{ type: 'callback', text: '⚙️ Инструкция установки', payload: 'instruction' }],
      [{ type: 'callback', text: '🛟 Поддержка', payload: 'support' }],
      [{ type: 'callback', text: '👥 Реферальная система', payload: 'referral' }],
    ];

    if (this.channelLink) {
      buttons.push([{ type: 'link', text: '📡 Наш канал', url: this.channelLink }]);
    }

    const attachments: MaxAttachment[] = [];

    if (imageToken) {
      attachments.push({ type: 'image', payload: { token: imageToken } });
    }

    attachments.push({ type: 'inline_keyboard', payload: { buttons } });

    return {
      text,
      format: 'markdown',
      attachments,
    };
  }

  /** Страница выбора тарифа */
  async buildPlansPage(): Promise<NewMessageBody> {
    const plans = await this.plansService.findAll();
    const activePlans = plans.filter((p) => p.isActive);

    if (activePlans.length === 0) {
      return {
        text: '😔 Тарифы временно недоступны. Попробуйте позже.',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [[{ type: 'callback', text: '◀️ Назад', payload: 'main_menu' }]],
            },
          },
        ],
      };
    }

    const lines: string[] = ['🎁 **Выберите тариф:**\n'];

    const buttons: MaxButtonRow[] = [];

    for (const plan of activePlans) {
      const dataLabel = plan.dataLimitGB > 0 ? ` • ${plan.dataLimitGB} GB` : ' • ♾ безлимит';
      lines.push(`**${plan.label}** — ${plan.price}₽${dataLabel}`);
      if (plan.description) {
        lines.push(`  _${plan.description}_`);
      }
      buttons.push([
        {
          type: 'callback',
          text: `${plan.label} — ${plan.price}₽`,
          payload: `plan:${plan.id}`,
        },
      ]);
    }

    buttons.push([{ type: 'callback', text: '◀️ Назад', payload: 'main_menu' }]);

    return {
      text: lines.join('\n'),
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Страница "Моя подписка" */
  async buildMySubscriptionPage(userId: number): Promise<NewMessageBody> {
    const subscription = await this.subscriptionsService.getActiveSubscriptionByMaxId(String(userId));

    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' },
    ];

    if (!subscription) {
      return {
        text: '📭 У вас нет активной подписки.\n\nНажмите «Приобрести подписку», чтобы оформить её.',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [
                [{ type: 'callback', text: '— Приобрести подписку —', payload: 'buy_sub' }],
                backButton,
              ],
            },
          },
        ],
      };
    }

    let subPageUrl: string | null = null;
    try {
      subPageUrl = await this.subscriptionsService.getSubPageUrl(subscription.id);
    } catch {
      subPageUrl = null;
    }

    if (!subPageUrl) {
      return {
        text: '⚠️ Не удалось получить ссылку на подписку. Обратитесь в поддержку.',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: { buttons: [backButton] },
          },
        ],
      };
    }

    const buttons: MaxButtonRow[] = [
      [{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }],
      backButton,
    ];

    return {
      text: `✅ **Ваша подписка активна!**\n\nНа странице подписки вы найдёте ключ доступа и инструкцию по подключению.`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Инструкция установки */
  async buildInstructionPage(userId: number): Promise<NewMessageBody> {
    const subscription = await this.subscriptionsService.getActiveSubscriptionByMaxId(String(userId));

    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' },
    ];

    let subPageUrl: string | null = null;
    if (subscription) {
      try {
        subPageUrl = await this.subscriptionsService.getSubPageUrl(subscription.id);
      } catch {
        subPageUrl = null;
      }
    }

    const text =
      `📖 **Инструкция по установке HIT VPN**\n\n` +
      `1. Откройте вашу страницу подписки\n` +
      `2. Скопируйте ключ подписки\n` +
      `3. Установите VPN-клиент (рекомендуем Hiddify или V2Box)\n` +
      `4. Добавьте ключ в приложение\n` +
      `5. Подключитесь и пользуйтесь!`;

    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else {
      buttons.push([
        { type: 'callback', text: '— Приобрести подписку —', payload: 'buy_sub' },
      ]);
    }

    buttons.push(backButton);

    return {
      text,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Реферальная система */
  buildReferralPage(userId: number): NewMessageBody {
    const referralLink = this.referralBaseUrl
      ? `${this.referralBaseUrl.replace(/\/$/, '')}?start=ref_${userId}`
      : null;

    const lines: string[] = [
      `👥 **Реферальная система**\n`,
      `Приглашайте друзей и получайте бонусные дни подписки!\n`,
      `🎁 За каждого приглашённого друга, который купит подписку, вы получаете **+10 дней** к своей подписке.\n`,
    ];

    if (referralLink) {
      lines.push(`🔗 Ваша реферальная ссылка:\n\`${referralLink}\``);
    }

    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' },
    ];

    const buttons: MaxButtonRow[] = [];

    if (referralLink) {
      buttons.push([
        { type: 'clipboard', text: '📋 Скопировать ссылку', payload: referralLink },
      ]);
    }

    buttons.push(backButton);

    return {
      text: lines.join('\n'),
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Поддержка */
  buildSupportPage(): NewMessageBody {
    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' },
    ];

    const buttons: MaxButtonRow[] = [];

    if (this.supportContact) {
      buttons.push([
        { type: 'link', text: '✉️ Написать в поддержку', url: this.supportContact },
      ]);
    }

    buttons.push(backButton);

    return {
      text: `🛟 **Поддержка**\n\nЕсли у вас возникли вопросы или проблемы — напишите нам, мы поможем!`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Подтверждение заказа и ссылка на оплату */
  buildPaymentPage(planLabel: string, price: number, paymentUrl: string): NewMessageBody {
    return {
      text:
        `💳 **Оплата подписки**\n\n` +
        `Тариф: **${planLabel}**\n` +
        `Сумма: **${price}₽**\n\n` +
        `Нажмите кнопку ниже для перехода к оплате.\n` +
        `После успешной оплаты вы получите ссылку на подписку автоматически.`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'link', text: `💳 Оплатить ${price}₽`, url: paymentUrl }],
              [{ type: 'callback', text: '◀️ Назад к тарифам', payload: 'buy_sub' }],
            ],
          },
        },
      ],
    };
  }

  /** Успешная оплата */
  buildPaymentSuccessPage(
    planLabel: string,
    subPageUrl: string | null,
    subscriptionUrl: string | null,
  ): NewMessageBody {
    const text =
      `🎉 **Подписка успешно активирована!**\n\n` +
      `Тариф: **${planLabel}**\n\n` +
      `На вашей странице подписки вы найдёте ключ доступа и пошаговую инструкцию по подключению.`;

    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else if (subscriptionUrl) {
      buttons.push([{ type: 'clipboard', text: '📋 Скопировать ключ подписки', payload: subscriptionUrl }]);
    }

    buttons.push([{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }]);

    return {
      text,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Ошибка генерации ключа */
  buildKeyErrorPage(): NewMessageBody {
    return {
      text: `⚠️ **Ошибка генерации ключа**\n\nОплата прошла успешно, но произошла ошибка при активации подписки. Мы уже разбираемся. Обратитесь в поддержку, указав ваш ID.`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'callback', text: '🛟 Поддержка', payload: 'support' }],
              [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
            ],
          },
        },
      ],
    };
  }

  /** Уведомление рефереру о бонусе */
  buildReferralBonusNotification(days: number, subPageUrl?: string): NewMessageBody {
    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Моя подписка', url: subPageUrl }]);
    }

    buttons.push([{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }]);

    return {
      text: `🎁 **Вам начислен бонус!**\n\nВаш друг купил подписку, и вы получили **+${days} дней** к своей подписке. Спасибо за приглашение!`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }
}
