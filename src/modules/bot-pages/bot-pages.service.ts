import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { NewMessageBody, MaxButtonRow } from '@modules/max-api';
import { PlansService } from '@modules/plans';
import { SubscriptionsService } from '@modules/subscriptions';
import { BotState } from '@database/entities';

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
  // private channelLink: string;
  private referralBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    @InjectRepository(BotState)
    private readonly botStateRepository: Repository<BotState>,
  ) {
    // this.channelLink = this.configService.get<string>('bot.channelLink', '');
    this.referralBaseUrl = this.configService.get<string>('max.referralBaseUrl', '');
  }

  private async getSupportContact(): Promise<string> {
    const row = await this.botStateRepository.findOne({ where: { name: 'support_contact' } });
    const fromDb = row?.value?.trim();
    if (fromDb) return fromDb;
    return this.configService.get<string>('bot.supportContact', '') || '';
  }

  /** Главное меню */
  buildMainMenu(userId: number, userName?: string): NewMessageBody {
    const greeting = userName ? `👋 Привет, **${userName}**!\n\n` : '';
    const text = `${greeting}${MAIN_TEXT}\n\n🆔 Ваш ID: \`${userId}\``;

    const buttons: MaxButtonRow[] = [
      [{ type: 'callback', text: '💳 Приобрести подписку', payload: 'buy_sub' }],
      [{ type: 'callback', text: '💎 Моя подписка', payload: 'my_sub' }],
      [{ type: 'callback', text: '⚙️ Инструкция установки', payload: 'instruction' }],
      [{ type: 'callback', text: '🛟 Поддержка', payload: 'support' }],
      [{ type: 'callback', text: '👥 Реферальная система', payload: 'referral' }],
    ];

    // if (this.channelLink) {
    //   buttons.push([{ type: 'link', text: '📡 Наш канал', url: this.channelLink }]);
    // }

    buttons.push([
      { type: 'callback', text: '📄 Политика конфиденциальности', payload: 'privacy_policy' },
    ]);
    buttons.push([
      { type: 'callback', text: '📋 Пользовательское соглашение', payload: 'terms_of_service' },
    ]);

    return {
      text,
      format: 'markdown',
      attachments: [{ type: 'inline_keyboard', payload: { buttons } }],
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
                [{ type: 'callback', text: '💳 Приобрести подписку', payload: 'buy_sub' }],
                backButton,
              ],
            },
          },
        ],
      };
    }

    let subPageUrl: string | null = null;
    let subscriptionUrl: string | null = null;
    try {
      subPageUrl = await this.subscriptionsService.getSubPageUrl(subscription.id);
    } catch {
      subPageUrl = null;
    }
    try {
      subscriptionUrl = await this.subscriptionsService.getSubscriptionUrl(subscription.id);
    } catch {
      subscriptionUrl = null;
    }

    if (!subPageUrl && !subscriptionUrl) {
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

    const displayUrl = subPageUrl || subscriptionUrl;
    const keySection = displayUrl
      ? `\n\n🔑 **Ключ подписки:**\n\`${displayUrl}\``
      : '';

    const buttons: MaxButtonRow[] = [];
    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else if (subscriptionUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subscriptionUrl }]);
    }
    buttons.push(backButton);

    return {
      text: `✅ **Ваша подписка активна!**` + keySection + `\n\nНа странице подписки вы найдёте инструкцию по подключению.`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: { buttons },
        },
      ],
    };
  }

  /** Инструкция установки — выбор устройства */
  async buildInstructionPage(_userId: number): Promise<NewMessageBody> {
    const text =
      `⚙️ **Инструкция по установке**\n\n` +
      `Простое подключение за 3 шага\n\n` +
      `Выберите ваше устройство, чтобы получить ссылки на скачивание Happ VPN:`;

    const buttons: MaxButtonRow[] = [
      [
        { type: 'callback', text: '🍎 iPhone / iPad', payload: 'instruction:iphone' },
        { type: 'callback', text: '🤖 Android', payload: 'instruction:android' },
      ],
      [
        { type: 'callback', text: '🖥 MacBook / iMac', payload: 'instruction:macos' },
        { type: 'callback', text: '🪟 Windows', payload: 'instruction:windows' },
      ],
      [
        { type: 'callback', text: '📺 Apple TV', payload: 'instruction:appletv' },
        { type: 'callback', text: '📺 Android TV', payload: 'instruction:androidtv' },
      ],
      [{ type: 'callback', text: '◀️ Назад', payload: 'main_menu' }],
    ];

    return {
      text,
      format: 'markdown',
      attachments: [{ type: 'inline_keyboard', payload: { buttons } }],
    };
  }

  /** Инструкция для конкретного устройства */
  async buildInstructionDevicePage(userId: number, device: string): Promise<NewMessageBody> {
    const subscription = await this.subscriptionsService.getActiveSubscriptionByMaxId(String(userId));

    let subPageUrl: string | null = null;
    if (subscription) {
      try {
        subPageUrl = await this.subscriptionsService.getSubPageUrl(subscription.id);
      } catch {
        subPageUrl = null;
      }
    }

    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Назад', payload: 'instruction' },
    ];

    const deviceInstructions: Record<string, { title: string; steps: string }> = {
      iphone: {
        title: '🍎 iPhone / iPad',
        steps:
          `1. Скачайте **Happ VPN** (либо - Incy) из App Store\n` +
          `2. Откройте страницу подписки и скопируйте ключ\n` +
          `3. В приложении нажмите «+» и вставьте ключ\n` +
          `4. Нажмите «Подключить» — готово!`,
      },
      android: {
        title: '🤖 Android',
        steps:
          `1. Скачайте **Happ VPN** из Google Play или APK\n` +
          `2. Откройте страницу подписки и скопируйте ключ\n` +
          `3. В приложении нажмите «+» и вставьте ключ\n` +
          `4. Нажмите «Подключить» — готово!`,
      },
      macos: {
        title: '🖥 MacBook / iMac',
        steps:
          `1. Скачайте **Happ VPN** из Mac App Store\n` +
          `2. Откройте страницу подписки и скопируйте ключ\n` +
          `3. В приложении нажмите «+» и вставьте ключ\n` +
          `4. Нажмите «Подключить» — готово!`,
      },
      windows: {
        title: '🪟 Windows',
        steps:
          `1. Скачайте установщик **Happ VPN** для Windows\n` +
          `2. Установите приложение и откройте его\n` +
          `3. Откройте страницу подписки и скопируйте ключ\n` +
          `4. В приложении нажмите «+», вставьте ключ и подключитесь!`,
      },
      appletv: {
        title: '📺 Apple TV',
        steps:
          `1. Скачайте **Happ VPN** из App Store на Apple TV\n` +
          `2. На телефоне или компьютере откройте страницу подписки\n` +
          `3. Скопируйте ключ и введите его в приложении на TV\n` +
          `4. Нажмите «Подключить» — готово!`,
      },
      androidtv: {
        title: '📺 Android TV',
        steps:
          `1. Скачайте **Happ VPN** из Google Play на Android TV\n` +
          `2. На телефоне или компьютере откройте страницу подписки\n` +
          `3. Скопируйте ключ и введите его в приложении на TV\n` +
          `4. Нажмите «Подключить» — готово!`,
      },
    };

    const info = deviceInstructions[device];
    if (!info) {
      return {
        text: '❌ Устройство не найдено.',
        attachments: [{ type: 'inline_keyboard', payload: { buttons: [backButton] } }],
      };
    }

    const text = `**${info.title}**\n\n${info.steps}`;

    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else {
      buttons.push([{ type: 'callback', text: '💳 Приобрести подписку', payload: 'buy_sub' }]);
    }

    buttons.push(backButton);

    return {
      text,
      format: 'markdown',
      attachments: [{ type: 'inline_keyboard', payload: { buttons } }],
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
  async buildSupportPage(): Promise<NewMessageBody> {
    const backButton: MaxButtonRow = [
      { type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' },
    ];

    const buttons: MaxButtonRow[] = [];
    const supportContact = await this.getSupportContact();

    if (supportContact) {
      buttons.push([
        { type: 'link', text: '✉️ Написать в поддержку', url: supportContact },
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
    const displayUrl = subPageUrl || subscriptionUrl;
    const keySection = displayUrl
      ? `\n\n🔑 **Ключ подписки:**\n\`${displayUrl}\``
      : '';

    const text =
      `🎉 **Подписка успешно активирована!**\n\n` +
      `Тариф: **${planLabel}**` +
      keySection +
      `\n\nНа странице подписки вы найдёте инструкцию по подключению.`;

    const buttons: MaxButtonRow[] = [];

    if (subPageUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subPageUrl }]);
    } else if (subscriptionUrl) {
      buttons.push([{ type: 'link', text: '🔑 Открыть страницу подписки', url: subscriptionUrl }]);
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

  /** Политика конфиденциальности */
  buildPrivacyPolicyPage(): NewMessageBody {
    const text =
      `📄 **Политика конфиденциальности**\n` +
      `_Дата вступления в силу: 19 августа 2025 г._\n\n` +
      `**1. Общие положения**\n` +
      `1.1. Настоящая Политика конфиденциальности (далее — «Политика») регулирует порядок обработки и защиты информации, которую Пользователь передаёт при использовании данного сервиса (далее — «Сервис»).\n` +
      `1.2. Используя Сервис, Пользователь подтверждает своё согласие с условиями Политики. Если Пользователь не согласен с условиями — он обязан прекратить использование Сервиса.\n\n` +
      `**2. Сбор информации**\n` +
      `2.1. Сервис может собирать следующие типы данных:\n` +
      `— идентификаторы аккаунта (логин, ID, никнейм и т.п.);\n` +
      `— техническую информацию (IP-адрес, данные о браузере, устройстве и операционной системе);\n` +
      `— историю взаимодействий с Сервисом.\n` +
      `2.2. Сервис не требует от Пользователя предоставления паспортных данных, документов, фотографий или другой личной информации, кроме минимально необходимой для работы.\n\n` +
      `**3. Использование информации**\n` +
      `3.1. Сервис может использовать полученную информацию исключительно для:\n` +
      `— обеспечения работы функционала;\n` +
      `— связи с Пользователем (в том числе для уведомлений и поддержки);\n` +
      `— анализа и улучшения работы Сервиса.\n\n` +
      `**4. Передача информации третьим лицам**\n` +
      `4.1. Администрация не передаёт полученные данные третьим лицам, за исключением случаев:\n` +
      `— если это требуется по закону;\n` +
      `— если это необходимо для исполнения обязательств перед Пользователем (например, при работе с платёжными системами);\n` +
      `— если Пользователь сам дал на это согласие.\n\n` +
      `**5. Хранение и защита данных**\n` +
      `5.1. Данные хранятся в течение срока, необходимого для достижения целей обработки.\n` +
      `5.2. Администрация принимает разумные меры для защиты данных, но не гарантирует абсолютную безопасность информации при передаче через интернет.\n\n` +
      `**6. Отказ от ответственности**\n` +
      `6.1. Пользователь понимает и соглашается, что передача информации через интернет всегда сопряжена с рисками.\n` +
      `6.2. Администрация не несёт ответственности за утрату, кражу или раскрытие данных, если это произошло по вине третьих лиц или самого Пользователя.\n\n` +
      `**7. Изменения в Политике**\n` +
      `7.1. Администрация вправе изменять условия Политики без предварительного уведомления.\n` +
      `7.2. Продолжение использования Сервиса после внесения изменений означает согласие Пользователя с новой редакцией Политики.`;

    return {
      text,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'callback', text: '📎 Ознакомиться с полной версией', payload: 'dl_privacy_pdf' }],
              [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
            ],
          },
        },
      ],
    };
  }

  /** Пользовательское соглашение */
  buildTermsOfServicePage(): NewMessageBody {
    const text =
      `📋 **Пользовательское соглашение**\n` +
      `_Дата вступления в силу: 19 августа 2025 г._\n\n` +
      `**1. Общие положения**\n` +
      `1.1. Настоящее Пользовательское соглашение (далее — «Соглашение») регулирует порядок использования данного сервиса (далее — «Сервис»), предоставляемого Администрацией.\n` +
      `1.2. Используя Сервис, включая запуск бота, регистрацию, оплату услуг или получение доступа к материалам, Пользователь подтверждает, что полностью ознакомился с условиями настоящего Соглашения и принимает их в полном объёме.\n` +
      `1.3. В случае несогласия с условиями Соглашения Пользователь обязан прекратить использование Сервиса.\n\n` +
      `**2. Характер услуг и цифровых товаров**\n` +
      `2.1. Сервис предоставляет цифровые товары и услуги нематериального характера, включая, но не ограничиваясь: VPN-доступ, информационные материалы и сервисные услуги.\n` +
      `2.2. Пользователь осознаёт и соглашается, что ценность услуг Сервиса заключается в обеспечении безопасного и стабильного доступа к интернету, технической поддержке и обновлениях.\n` +
      `2.3. Сервис не заявляет и не гарантирует уникальность или эксклюзивность отдельных элементов материалов вне Сервиса.\n\n` +
      `**3. Отказ от гарантий и ответственности**\n` +
      `3.1. Сервис предоставляется на условиях «AS IS» («как есть»).\n` +
      `3.2. Администрация не гарантирует:\n` +
      `— соответствие Сервиса ожиданиям Пользователя;\n` +
      `— достижение каких-либо результатов;\n` +
      `— бесперебойную и безошибочную работу Сервиса.\n` +
      `3.3. Администрация не несёт ответственности за:\n` +
      `— любые прямые или косвенные убытки;\n` +
      `— действия или бездействие третьих лиц;\n` +
      `— временные технические сбои и ограничения доступа.\n\n` +
      `**4. Законность использования**\n` +
      `4.1. Сервис не предназначен для поощрения, организации или содействия противоправной деятельности.\n` +
      `4.2. Пользователь обязуется использовать Сервис исключительно в рамках применимого законодательства.\n` +
      `4.3. Ответственность за законность использования Сервиса полностью возлагается на Пользователя.\n\n` +
      `**5. Интеллектуальная собственность**\n` +
      `5.1. Все материалы, размещённые в Сервисе, охраняются законодательством об интеллектуальной собственности.\n` +
      `5.2. Пользователю запрещается копировать, распространять, перепродавать или передавать третьим лицам материалы Сервиса без разрешения правообладателя.\n\n` +
      `**6. Ограничение доступа**\n` +
      `6.1. Администрация вправе приостановить или ограничить доступ Пользователя к Сервису в случае:\n` +
      `— нарушения условий настоящего Соглашения;\n` +
      `— выявления злоупотреблений;\n` +
      `— требований законодательства или платёжных провайдеров.\n` +
      `6.2. Ограничение доступа не освобождает Пользователя от обязательств, возникших ранее.\n\n` +
      `**7. Платежи и возвраты**\n` +
      `7.1. Оплата услуг производится на условиях, указанных в Сервисе до момента оплаты.\n` +
      `7.2. Возврат денежных средств после предоставления доступа не осуществляется, за исключением случаев:\n` +
      `— услуга не была оказана по технической вине Сервиса;\n` +
      `— доступ к цифровому товару фактически не был предоставлен.\n` +
      `7.3. Для рассмотрения вопроса о возврате Пользователь обязан обратиться в службу поддержки в течение 24 часов с момента оплаты.\n` +
      `7.4. Пользователь обязуется не инициировать возврат платежа (chargeback) через платёжные системы без предварительного обращения в поддержку.\n\n` +
      `**8. Конфиденциальность**\n` +
      `8.1. Администрация может собирать минимально необходимые технические данные для обеспечения работы Сервиса.\n` +
      `8.2. Администрация принимает разумные меры для защиты данных, однако не гарантирует абсолютную безопасность передаваемой информации.\n\n` +
      `**9. Изменение условий**\n` +
      `9.1. Администрация вправе вносить изменения в настоящее Соглашение.\n` +
      `9.2. Продолжение использования Сервиса означает согласие Пользователя с обновлёнными условиями.\n\n` +
      `**10. Контактная информация**\n` +
      `10.1. По всем вопросам Пользователь может обратиться в службу поддержки через бота.\n\n` +
      `_Используя Сервис (в том числе запуская бота и/или вводя команду /start), Пользователь подтверждает, что ознакомлен с настоящим Соглашением и принимает его условия в полном объёме._`;

    return {
      text,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'callback', text: '📎 Ознакомиться с полной версией', payload: 'dl_terms_pdf' }],
              [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
            ],
          },
        },
      ],
    };
  }

  /**
   * Сообщение со ссылкой на PDF. MAX не умеет слать документы как вложение,
   * поэтому отдаём публичный URL `/assets/<file>` (как в max-bot-v2).
   */
  buildDocumentLinkPage(
    kind: 'privacy' | 'terms',
  ): NewMessageBody {
    const filename =
      kind === 'privacy' ? 'privacy-policy.pdf' : 'user-agreements.pdf';
    const caption =
      kind === 'privacy'
        ? '🔒 **Политика конфиденциальности HIT VPN**'
        : '📄 **Пользовательское соглашение HIT VPN**';
    const backPayload =
      kind === 'privacy' ? 'privacy_policy' : 'terms_of_service';
    const url = this.assetUrl(filename);

    if (!url) {
      return {
        text: '⚠️ Не удалось сформировать ссылку на документ. Попробуйте позже.',
        attachments: [
          {
            type: 'inline_keyboard',
            payload: {
              buttons: [[{ type: 'callback', text: '◀️ Назад', payload: backPayload }]],
            },
          },
        ],
      };
    }

    return {
      text: `${caption}\n\n📄 [${filename}](${url})`,
      format: 'markdown',
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [{ type: 'link', text: '📎 Открыть PDF', url }],
              [{ type: 'callback', text: '◀️ Назад', payload: backPayload }],
            ],
          },
        },
      ],
    };
  }

  private assetUrl(filename: string): string | null {
    const base = (this.configService.get<string>('app.baseUrl') || '').replace(
      /\/$/,
      '',
    );
    return base ? `${base}/assets/${filename}` : null;
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
