import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { BotPage, BotButton } from '@database/entities';
import { CreateBotPageDto } from './dto/create-bot-page.dto';
import { UpdateBotPageDto } from './dto/update-bot-page.dto';

/** Страница бота по умолчанию (seed) */
interface DefaultPage {
  key: string;
  title: string;
  description: string;
  text: string;
  buttons: BotButton[][];
  sortOrder: number;
}

const DEFAULT_PAGES: DefaultPage[] = [
  {
    key: 'menu',
    title: '📋 Главное меню',
    description: 'Главное меню бота с кнопками навигации',
    sortOrder: 1,
    text: `🚀 <b>VPN HIT</b>\n\nБыстрый доступ к интернету без лишних шагов. Выберите нужный раздел:`,
    buttons: [
      [{ text: '🛒 Приобрести доступ', callbackData: 'buy_subscription' }],
      [{ text: '📖 Инструкция', callbackData: 'instructions' }],
      [{ text: '🔑 Моя подписка', callbackData: 'my_subscription' }, { text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' }],
      [{ text: '👥 Реферальная система', callbackData: 'referral' }],
      [{ text: 'ℹ️ О сервисе', callbackData: 'about_menu' }],
    ],
  },
  {
    key: 'buy_additional_type_select',
    title: '🔧 Выбор типа доп. подписки',
    description: 'Показывается при покупке дополнительной подписки — выбор типа Базовый/Антиглушилка',
    sortOrder: 2,
    text: `🔧 <b>Дополнительная подписка</b>\n\nВыберите тип подписки:\n\n🌐 <b>Базовый</b> — безлимитный трафик, доступ ко всем сервисам\n\n⚡ <b>Антиглушилка</b> — обход блокировок мессенджеров и соцсетей\n✅ Работает: WhatsApp, Telegram, Instagram\n❌ Не работает: YouTube, ChatGPT и другие сервисы, заблокированные в России`,
    buttons: [
      [{ text: '🌐 Базовый', callbackData: 'buy_add_std' }],
      [{ text: '⚡ Антиглушилка', callbackData: 'buy_add_anti' }],
      [{ text: '◀️ Назад', callbackData: 'my_add_subs' }],
    ],
  },
  {
    key: 'anti_throttling_description',
    title: '⚡ Описание Антиглушилки',
    description: 'Описание тарифа Антиглушилка перед выбором тарифного плана',
    sortOrder: 3,
    text: `⚡ <b>Антиглушилка</b>\n\n✅ Работает: WhatsApp, Telegram, Instagram\n❌ Не работает: YouTube, ChatGPT и другие сервисы, заблокированные в России\n\n<b>Выберите тариф:</b>`,
    buttons: [],
  },
  {
    key: 'referral',
    title: '👥 Реферальная программа',
    description: 'Информация о реферальной программе. Переменные: {{referralLink}}',
    sortOrder: 4,
    text: `👥 <b>Реферальная система</b>\n\nПриглашайте друзей и получайте бонус.\n\n🎁 <b>За каждую первую оплату по вашей ссылке:</b>\n• <b>+10 дней</b> к вашей подписке\n\n🔗 <b>Ваша ссылка:</b>\n<code>{{referralLink}}</code>`,
    buttons: [
      [{ text: '🔗 Скопировать ссылку', callbackData: 'referral' }],
      [{ text: '🏠 Главное меню', callbackData: 'menu' }],
    ],
  },
  {
    key: 'instructions',
    title: '📖 Инструкция по подключению',
    description: 'Инструкция по подключению VPN — как использовать ссылку подписки',
    sortOrder: 5,
    text: `📖 <b>Как подключить VPN HIT</b>\n\n1. Откройте <b>«Моя подписка»</b>.\n2. Перейдите на страницу подписки.\n3. Подключите устройство по инструкции на странице.\n\nЕсли возникнут вопросы, напишите в поддержку.`,
    buttons: [
      [{ text: '🏠 Главное меню', callbackData: 'menu' }],
    ],
  },
  {
    key: 'about_menu',
    title: 'ℹ️ О сервисе',
    description: 'Меню раздела «О сервисе»',
    sortOrder: 6,
    text: `ℹ️ <b>О VPN HIT</b>\n\nVPN HIT помогает сохранить доступ к привычным сервисам и стабильное соединение без сложной настройки.\n\n💬 Поддержка: @vpn_hit_support\n\nВыберите раздел:`,
    buttons: [
      [{ text: '🔒 Политика конфиденциальности', callbackData: 'about_privacy' }],
      [{ text: '📄 Пользовательское соглашение', callbackData: 'about_terms' }],
      [{ text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' }],
      [{ text: '🏠 Главное меню', callbackData: 'menu' }],
    ],
  },
  {
    key: 'privacy_policy',
    title: '🔒 Политика конфиденциальности',
    description: 'Текст политики конфиденциальности',
    sortOrder: 7,
    text: `🔒 <b>Политика конфиденциальности VPN HIT</b>\n<i>Редакция от 01.01.2025</i>\n\n<b>1. Какие данные мы собираем</b>\n• ID пользователя и служебные данные аккаунта.\n• Данные об оплате без реквизитов карт.\n• Мы <b>не ведём</b> логи посещённых сайтов и трафика.\n\n<b>2. Как мы используем данные</b>\n• Выдача доступа к сервису.\n• Уведомления о подписке.\n• Начисление реферальных бонусов.\n• Обработка платежей.\n\n<b>3. Передача данных</b>\nМы не продаём персональные данные третьим лицам.\n\n<b>4. Ваши права</b>\nВы можете запросить удаление данных через поддержку: @santa_vpn_help.`,
    buttons: [
      [{ text: '◀️ Назад', callbackData: 'about_menu' }],
    ],
  },
  {
    key: 'terms_of_service',
    title: '📄 Пользовательское соглашение',
    description: 'Текст пользовательского соглашения',
    sortOrder: 8,
    text: `📄 <b>Пользовательское соглашение VPN HIT</b>\n<i>Редакция от 01.01.2025</i>\n\n<b>1. Предмет соглашения</b>\nVPN HIT предоставляет доступ к сервису для частных лиц. Используя сервис, вы принимаете условия соглашения.\n\n<b>2. Условия использования</b>\n• Сервис предназначен для личного использования.\n• Передача доступа третьим лицам запрещена.\n• Один аккаунт — один пользователь.\n\n<b>3. Запрещённые действия</b>\nЗапрещено использовать сервис для противоправных действий, спама, вредоносной активности и атак на сторонние системы.\n\n<b>4. Оплата и возврат</b>\nПо вопросам оплаты и возврата обращайтесь в поддержку: @santa_vpn_help.\n\n<b>5. Изменения условий</b>\nМы можем обновлять условия, актуальная версия доступна в боте.`,
    buttons: [
      [{ text: '◀️ Назад', callbackData: 'about_menu' }],
    ],
  },
  {
    key: 'subscription_expiring',
    title: '⚠️ Уведомление об истечении подписки',
    description: 'Отправляется автоматически при скором истечении подписки. Переменные: {{endDate}}',
    sortOrder: 9,
    text: `⚠️ <b>Подписка скоро закончится</b>\n\n📅 До: {{endDate}}\n\nПродлите доступ заранее, чтобы не потерять соединение.`,
    buttons: [
      [{ text: '📱 Мои подписки', callbackData: 'my_subscription' }],
      [{ text: '🏠 Главное меню', callbackData: 'menu' }],
    ],
  },
  {
    key: 'my_additional_empty',
    title: '📦 Нет дополнительных подписок',
    description: 'Показывается когда у пользователя нет дополнительных подписок',
    sortOrder: 10,
    text: `📦 <b>Дополнительные подписки</b>\n\nУ вас пока нет дополнительных подписок.\n\n🎁 Вы можете создать дополнительную подписку для использования на другом устройстве или подарить другу.`,
    buttons: [
      [{ text: '🔧 Купить дополнительную', callbackData: 'buy_add' }],
      [{ text: '🏠 Главное меню', callbackData: 'menu' }],
    ],
  },
  {
    key: 'buy_subscription',
    title: '💳 Покупка подписки',
    description: 'Экран покупки единой подписки',
    sortOrder: 11,
    text: `💳 <b>Выберите тариф VPN HIT</b>\n\nОдин тип подписки. Разница только в сроке и стоимости.`,
    buttons: [
      [{ text: '◀️ Назад', callbackData: 'menu' }],
    ],
  },
  {
    key: 'my_subscription',
    title: '🔑 Моя подписка',
    description: 'Заголовок экрана «Моя подписка»',
    sortOrder: 12,
    text: `🔑 <b>Моя подписка</b>\n\nОткройте страницу подписки, чтобы посмотреть статус, продлить доступ и подключить устройство.`,
    buttons: [],
  },
];

@Injectable()
export class BotPagesService implements OnModuleInit {
  private readonly logger = new Logger(BotPagesService.name);
  private readonly uploadsDir = path.join(process.cwd(), 'uploads', 'bot-pages');

  constructor(
    @InjectRepository(BotPage)
    private readonly repo: Repository<BotPage>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Создаём папку для загрузок
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    // Засеиваем страницы по умолчанию (только если ключ ещё не существует)
    for (const page of DEFAULT_PAGES) {
      const exists = await this.repo.findOne({ where: { key: page.key } });
      if (!exists) {
        await this.repo.save(
          this.repo.create({
            ...page,
            mediaType: 'none',
            mediaPath: null,
            mediaTelegramFileId: null,
          }),
        );
        this.logger.log(`Seeded bot page: ${page.key}`);
      }
    }

    await this.fixCallbackData('my_additional_subscriptions', 'my_add_subs');
    await this.migrateMenuV2();
    await this.syncDefaultPageContent();

    // Удаляем неиспользуемые страницы из БД
    await this.deleteUnusedPages();

    // Миграция: переименовываем ключ 'referral_info' → 'referral' (если нет записи с ключом 'referral')
    const referralExists = await this.repo.findOne({ where: { key: 'referral' } });
    if (!referralExists) {
      const oldReferral = await this.repo.findOne({ where: { key: 'referral_info' } });
      if (oldReferral) {
        await this.repo.update(oldReferral.id, { key: 'referral' });
        this.logger.log(`Migrated bot page key: referral_info → referral`);
      }
    }
  }

  /** Заменяет callbackData во всех кнопках всех страниц */
  private async fixCallbackData(oldCb: string, newCb: string): Promise<void> {
    const pages = await this.repo.find();
    for (const page of pages) {
      let changed = false;
      const buttons = page.buttons.map(row =>
        row.map(btn => {
          if (btn.callbackData === oldCb) {
            changed = true;
            return { ...btn, callbackData: newCb };
          }
          return btn;
        }),
      );
      if (changed) {
        await this.repo.update(page.id, { buttons });
        this.logger.log(`Fixed callbackData ${oldCb}→${newCb} in page: ${page.key}`);
      }
    }
  }

  /** Обновляет кнопки меню: убирает «Дополнительные подписки», добавляет «Купить подписку» */
  private async migrateMenuV2(): Promise<void> {
    const menuPage = await this.repo.findOne({ where: { key: 'menu' } });
    if (!menuPage) return;

    // Проверяем: есть ли старая кнопка my_add_subs — если да, нужна миграция
    const hasOldButton = menuPage.buttons.some(row =>
      row.some(btn => btn.callbackData === 'my_add_subs'),
    );
    if (!hasOldButton) return;

    const newButtons: BotButton[][] = [
      [{ text: '🛒 Приобрести доступ', callbackData: 'buy_subscription' }],
      [{ text: '📖 Инструкция', callbackData: 'instructions' }],
      [{ text: '🔑 Моя подписка', callbackData: 'my_subscription' }, { text: '💬 Поддержка', url: 'https://t.me/vpn_hit_support' }],
      [{ text: '👥 Реферальная система', callbackData: 'referral' }],
      [{ text: 'ℹ️ О сервисе', callbackData: 'about_menu' }],
    ];
    await this.repo.update(menuPage.id, { buttons: newButtons });
    this.logger.log('Migrated menu page buttons (v2): removed additional subs, added buy subscription');
  }

  private async syncDefaultPageContent(): Promise<void> {
    for (const page of DEFAULT_PAGES) {
      const existing = await this.repo.findOne({ where: { key: page.key } });
      if (!existing) continue;

      await this.repo.update(existing.id, {
        title: page.title,
        description: page.description,
        text: page.text,
        buttons: page.buttons,
        sortOrder: page.sortOrder,
      });
    }
  }

  /** Удаляет устаревшие страницы, которые больше не используются ботом */
  private async deleteUnusedPages(): Promise<void> {
    const unusedKeys = ['welcome', 'payment_success', 'payment_error', 'trial_try_anti', 'trial_activated_new'];
    for (const key of unusedKeys) {
      const page = await this.repo.findOne({ where: { key } });
      if (page) {
        await this.repo.delete(page.id);
        this.logger.log(`Deleted unused bot page: ${key}`);
      }
    }
  }

  findAll(): Promise<BotPage[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  async findOne(id: number): Promise<BotPage> {
    const page = await this.repo.findOne({ where: { id } });
    if (!page) throw new NotFoundException(`Страница #${id} не найдена`);
    return page;
  }

  async findByKey(key: string): Promise<BotPage | null> {
    return this.repo.findOne({ where: { key } });
  }

  async create(dto: CreateBotPageDto): Promise<BotPage> {
    const page = this.repo.create({
      ...dto,
      text: dto.text ?? '',
      mediaType: dto.mediaType ?? 'none',
      buttons: dto.buttons ?? [],
      sortOrder: dto.sortOrder ?? 0,
      mediaPath: null,
      mediaTelegramFileId: null,
    });
    return this.repo.save(page);
  }

  async update(id: number, dto: UpdateBotPageDto): Promise<BotPage> {
    const page = await this.findOne(id);
    Object.assign(page, dto);
    return this.repo.save(page);
  }

  async updateMedia(id: number, file: Express.Multer.File, mediaType: 'photo' | 'video'): Promise<BotPage> {
    const page = await this.findOne(id);

    // Удаляем старый файл, если есть
    if (page.mediaPath && fs.existsSync(page.mediaPath)) {
      fs.unlinkSync(page.mediaPath);
    }

    page.mediaPath = file.path;
    page.mediaType = mediaType;
    page.mediaTelegramFileId = null; // сбрасываем кэш file_id

    return this.repo.save(page);
  }

  async removeMedia(id: number): Promise<BotPage> {
    const page = await this.findOne(id);
    if (page.mediaPath && fs.existsSync(page.mediaPath)) {
      fs.unlinkSync(page.mediaPath);
    }
    page.mediaPath = null;
    page.mediaType = 'none';
    page.mediaTelegramFileId = null;
    return this.repo.save(page);
  }

  async updateTelegramFileId(id: number, fileId: string): Promise<void> {
    await this.repo.update(id, { mediaTelegramFileId: fileId });
  }

  async remove(id: number): Promise<void> {
    const page = await this.findOne(id);
    if (page.mediaPath && fs.existsSync(page.mediaPath)) {
      fs.unlinkSync(page.mediaPath);
    }
    await this.repo.delete(id);
  }

  async reorder(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i++) {
      await this.repo.update(ids[i], { sortOrder: i });
    }
  }

  /**
   * Интерполирует {{переменные}} в тексте и URL кнопок
   */
  interpolate(text: string, vars: Record<string, string>): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
  }

  /**
   * Интерполирует переменные в кнопках
   */
  interpolateButtons(buttons: BotButton[][], vars: Record<string, string>): BotButton[][] {
    return buttons.map(row =>
      row.map(btn => ({
        ...btn,
        text: this.interpolate(btn.text, vars),
        url: btn.url ? this.interpolate(btn.url, vars) : btn.url,
      })),
    );
  }

  getUploadsDir(): string {
    return this.uploadsDir;
  }
}
