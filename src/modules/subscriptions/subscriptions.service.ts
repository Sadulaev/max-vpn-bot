import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Subscription,
  SubscriptionSource,
} from '@database/entities';
import { RemnawaveApiService } from '@modules/remnawave-api';
import type { RemnawaveUserResponse } from '@modules/remnawave-api';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';

// Enriched view
export interface SubscriptionEnriched extends Subscription {
  /** Статус из Remnawave (ACTIVE / DISABLED / EXPIRED / LIMITED) */
  remnawaveStatus: string | null;
  /** Дата истечения из Remnawave (ISO string). null = безлимит. */
  remnawaveExpire: number | null;
  /** URL подписки (страница Remnawave) */
  subscriptionUrl: string | null;
  /** Примечание из Remnawave */
  note: string | null;
  /** Использованный трафик (байты) */
  usedTraffic: number | null;
}

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
    private readonly remnawaveApi: RemnawaveApiService,
  ) {}

  /**
   * Построить username для VPN панели из subscriptionId.
   */
  private buildPanelUsername(subscriptionId: string): string {
    return subscriptionId.replace(/-/g, '');
  }

  private async findReusableSubscription(telegramId?: string): Promise<Subscription | null> {
    if (!telegramId) {
      return null;
    }

    return this.subscriptionRepo.findOne({
      where: {
        telegramId,
      },
      order: { createdAt: 'DESC' },
    });
  }

  private async syncSubscriptionPlan(
    subscription: Subscription,
    dataLimitGB?: number,
    note?: string,
  ): Promise<void> {
    const isAntiThrottling = !!(dataLimitGB && dataLimitGB > 0);

    subscription.isAntiThrottling = isAntiThrottling;
    if (note) {
      subscription.name = note.slice(0, 30);
    }

    const remnawaveUser = await this.getRemnawaveUser(subscription.id);
    if (!remnawaveUser) {
      await this.subscriptionRepo.save(subscription);
      return;
    }

    const squadUuid = this.remnawaveApi.getSquadUuid(isAntiThrottling);
    const tag = this.remnawaveApi.getTag(isAntiThrottling);
    const updatePayload: Parameters<typeof this.remnawaveApi.updateUser>[0] = {
      uuid: remnawaveUser.uuid,
      status: 'ACTIVE',
      tag,
      activeInternalSquads: squadUuid ? [squadUuid] : [],
    };

    if (isAntiThrottling) {
      updatePayload.trafficLimitBytes = dataLimitGB! * 1024 * 1024 * 1024;
      updatePayload.trafficLimitStrategy = 'NO_RESET';
      updatePayload.expireAt = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
    } else {
      const expireAt = new Date(subscription.startDate);
      expireAt.setDate(expireAt.getDate() + subscription.days);

      updatePayload.trafficLimitBytes = 0;
      updatePayload.trafficLimitStrategy = 'NO_RESET';
      updatePayload.expireAt = expireAt.toISOString();
    }

    await this.remnawaveApi.updateUser(updatePayload);

    if (!subscription.remnawaveUuid) {
      subscription.remnawaveUuid = remnawaveUser.uuid;
    }
    if (!subscription.shortUuid) {
      subscription.shortUuid = remnawaveUser.shortUuid;
    }

    await this.subscriptionRepo.save(subscription);
  }

  // ─── Создание ───

  /**
   * Создать подписку:
   * 1. Сгенерировать запись в БД → получить UUID
   * 2. Зарегистрировать пользователя в Remnawave
   * 3. Сохранить remnawaveUuid и shortUuid
   * 4. Вернуть subscriptionUrl
   */
  async createSubscription(dto: CreateSubscriptionDto): Promise<{
    subscriptionId: string;
    username: string | null;
    subscriptionUrl: string | null;
    shortUuid: string | null;
    subPageUrl: string | null;
  }> {
    const reusableSubscription = await this.findReusableSubscription(dto.telegramId);

    if (reusableSubscription) {
      const requestedIsAntiThrottling = !!(dto.dataLimitGB && dto.dataLimitGB > 0);

      reusableSubscription.source = dto.source ?? reusableSubscription.source;
      reusableSubscription.referrerId = dto.referrerId ?? reusableSubscription.referrerId;

      if (reusableSubscription.isAntiThrottling !== requestedIsAntiThrottling) {
        await this.syncSubscriptionPlan(
          reusableSubscription,
          dto.dataLimitGB,
          dto.note,
        );
      } else if (dto.note) {
        reusableSubscription.name = dto.note.slice(0, 30);
        await this.subscriptionRepo.save(reusableSubscription);
      } else {
        await this.subscriptionRepo.save(reusableSubscription);
      }

      await this.extendSubscription(
        reusableSubscription.id,
        dto.days,
        dto.dataLimitGB,
      );

      return {
        subscriptionId: reusableSubscription.id,
        username: reusableSubscription.username,
        subscriptionUrl: await this.getSubscriptionUrl(reusableSubscription.id),
        shortUuid: reusableSubscription.shortUuid,
        subPageUrl: await this.getSubPageUrl(reusableSubscription.id),
      };
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + dto.days);

    const isAntiThrottling = !!(dto.dataLimitGB && dto.dataLimitGB > 0);

    const subscription = this.subscriptionRepo.create({
      username: '',
      telegramId: dto.telegramId ?? null,
      source: dto.source ?? SubscriptionSource.ADMIN,
      days: dto.days,
      startDate,
      isAntiThrottling,
      isAdditional: false,
      referrerId: dto.referrerId ?? null,
      name: dto.note ? dto.note.slice(0, 30) : null,
    });
    await this.subscriptionRepo.save(subscription);

    if (!this.remnawaveApi.isConfigured()) {
      this.logger.warn(
        `Remnawave not configured. Subscription ${subscription.id} saved without panel link.`,
      );
      return { subscriptionId: subscription.id, username: null, subscriptionUrl: null, shortUuid: null, subPageUrl: null };
    }

    const panelUsername = this.buildPanelUsername(subscription.id);

    const dataLimitBytes = dto.dataLimitGB
      ? dto.dataLimitGB * 1024 * 1024 * 1024
      : 0;

    const squadUuid = this.remnawaveApi.getSquadUuid(isAntiThrottling);
    const tag = this.remnawaveApi.getTag(isAntiThrottling);
    const telegramIdNum = dto.telegramId ? parseInt(dto.telegramId, 10) : null;

    const description = dto.note
      ? `${subscription.id} | ${dto.note}`
      : subscription.id;

    try {
      const user = await this.remnawaveApi.createUser({
        username: panelUsername,
        expireAt: isAntiThrottling
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() // 1 год для антиглушилки
          : endDate.toISOString(),
        status: 'ACTIVE',
        trafficLimitBytes: dataLimitBytes,
        trafficLimitStrategy: 'NO_RESET',
        description,
        tag,
        telegramId: telegramIdNum,
        activeInternalSquads: squadUuid ? [squadUuid] : [],
        hwidDeviceLimit: 5,
      });

      subscription.username = panelUsername;
      subscription.remnawaveUuid = user.uuid;
      subscription.shortUuid = user.shortUuid;
      await this.subscriptionRepo.save(subscription);

      const subscriptionUrl = this.remnawaveApi.buildSubscriptionUrl(user.shortUuid);
      const subPageUrl = this.remnawaveApi.buildSubPageUrl(user.shortUuid);

      this.logger.log(
        `Subscription ${subscription.id} created → Remnawave user "${panelUsername}" (${user.uuid}), expires ${endDate.toISOString()}`,
      );

      return {
        subscriptionId: subscription.id,
        username: panelUsername,
        subscriptionUrl,
        shortUuid: user.shortUuid,
        subPageUrl,
      };
    } catch (error) {
      await this.subscriptionRepo.remove(subscription);
      throw error;
    }
  }

  // ─── Получение ───

  async findAll(): Promise<Subscription[]> {
    return this.subscriptionRepo.find({ order: { createdAt: 'DESC' } });
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({ where: { id } });
  }

  async findByUsername(username: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({ where: { username } });
  }

  async findByShortUuid(shortUuid: string): Promise<Subscription | null> {
    return this.subscriptionRepo.findOne({ where: { shortUuid } });
  }

  async search(params: {
    search?: string;
    source?: SubscriptionSource;
  }): Promise<Subscription[]> {
    const query = this.subscriptionRepo.createQueryBuilder('subscription');

    if (params.source && !params.search) {
      query.andWhere('subscription.source = :source', { source: params.source });
    }

    if (params.search) {
      query.andWhere(
        '(subscription.username ILIKE :search OR subscription.telegramId::text ILIKE :search)',
        { search: `%${params.search}%` },
      );
    }

    query.orderBy('subscription.createdAt', 'DESC');
    return query.getMany();
  }

  /**
   * Получить обогащённый список подписок (данные из БД + Remnawave).
   */
  async searchEnriched(params: {
    search?: string;
    source?: SubscriptionSource;
  }): Promise<SubscriptionEnriched[]> {
    const subs = await this.search(params);
    if (subs.length === 0) return [];

    const remnawaveMap = await this.fetchRemnawaveUserMap();

    return subs.map((sub) => {
      const ru = sub.username ? remnawaveMap.get(sub.username) ?? null : null;
      const expireTs = ru?.expireAt ? Math.floor(new Date(ru.expireAt).getTime() / 1000) : null;
      return {
        ...sub,
        remnawaveStatus: ru?.status ?? null,
        remnawaveExpire: expireTs,
        subscriptionUrl: ru
          ? this.remnawaveApi.buildSubscriptionUrl(sub.shortUuid ?? ru.shortUuid)
          : null,
        note: ru?.description ?? null,
        usedTraffic: ru?.userTraffic?.usedTrafficBytes ?? null,
      };
    });
  }

  /**
   * Загрузить всех пользователей из Remnawave (с пагинацией).
   * Возвращает Map: username → RemnawaveUserResponse.
   */
  async fetchRemnawaveUserMap(): Promise<Map<string, RemnawaveUserResponse>> {
    const map = new Map<string, RemnawaveUserResponse>();
    const pageSize = 500;

    let start = 0;
    while (true) {
      const page = await this.remnawaveApi.getUsers(start, pageSize);
      for (const u of page.users) {
        map.set(u.username, u);
      }
      if (start + pageSize >= page.total) break;
      start += pageSize;
    }

    return map;
  }

  /** Получить все уникальные Telegram ID из подписок */
  async getUniqueTelegramIds(): Promise<string[]> {
    const result = await this.subscriptionRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.telegramId', 'telegramId')
      .where('s.telegramId IS NOT NULL')
      .getRawMany();
    return result.map((r) => r.telegramId);
  }

  /** Получить данные одной подписки из Remnawave */
  async getRemnawaveUser(subscriptionId: string): Promise<RemnawaveUserResponse | null> {
    const sub = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!sub) return null;

    if (sub.remnawaveUuid) {
      return this.remnawaveApi.getUserByUuid(sub.remnawaveUuid);
    }
    if (sub.username) {
      return this.remnawaveApi.getUserByUsername(sub.username);
    }
    return null;
  }

  /**
   * Найти активные подписки telegramId.
   * Проверяет статус напрямую в Remnawave.
   */
  async getActiveSubscriptionsByTelegramId(telegramId: string): Promise<Subscription[]> {
    const subs = await this.subscriptionRepo.find({ where: { telegramId }, order: { createdAt: 'DESC' } });

    const results: Subscription[] = [];
    await Promise.all(
      subs.map(async (sub) => {
        if (!sub.username) return;
        const ru = sub.remnawaveUuid
          ? await this.remnawaveApi.getUserByUuid(sub.remnawaveUuid)
          : await this.remnawaveApi.getUserByUsername(sub.username);
        if (ru?.status === 'ACTIVE') {
          results.push(sub);
        }
      }),
    );
    return results;
  }

  async getActiveSubscriptionByTelegramId(telegramId: string): Promise<Subscription | null> {
    const actives = await this.getActiveSubscriptionsByTelegramId(telegramId);
    return actives[0] ?? null;
  }

  async getAllSubscriptionsByTelegramId(telegramId: string): Promise<Subscription[]> {
    return this.subscriptionRepo.find({ where: { telegramId }, order: { createdAt: 'DESC' } });
  }

  /** URL подписки для V2Ray клиента */
  async getSubscriptionUrl(subscriptionId: string): Promise<string> {
    const subscription = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    // Если есть shortUuid — строим URL напрямую
    if (subscription.shortUuid) {
      const url = this.remnawaveApi.buildSubscriptionUrl(subscription.shortUuid);
      if (url) return url;
    }

    // Фоллбэк: запрашиваем из Remnawave
    const ru = await this.getRemnawaveUser(subscriptionId);
    if (!ru) throw new NotFoundException('Remnawave user not found');

    // Обновляем shortUuid и remnawaveUuid если не были сохранены
    if (!subscription.shortUuid || !subscription.remnawaveUuid) {
      subscription.shortUuid = ru.shortUuid;
      subscription.remnawaveUuid = ru.uuid;
      await this.subscriptionRepo.save(subscription);
    }

    return this.remnawaveApi.buildSubscriptionUrl(ru.shortUuid)
      ?? ru.subscriptionUrl;
  }

  /** URL страницы подписки (для показа пользователю) */
  async getSubPageUrl(subscriptionId: string): Promise<string | null> {
    const subscription = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    if (subscription.shortUuid) {
      return this.remnawaveApi.buildSubPageUrl(subscription.shortUuid);
    }

    const ru = await this.getRemnawaveUser(subscriptionId);
    if (!ru) return null;

    subscription.shortUuid = ru.shortUuid;
    subscription.remnawaveUuid = ru.uuid;
    await this.subscriptionRepo.save(subscription);

    return this.remnawaveApi.buildSubPageUrl(ru.shortUuid);
  }

  // ─── Продление ───

  /**
   * Продлить подписку: получить текущий expire из Remnawave, прибавить дни,
   * обновить Remnawave и days в БД.
   */
  async extendSubscription(subscriptionId: string, days: number, dataLimitGb?: number): Promise<Subscription> {
    const subscription = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    subscription.days = subscription.days + days;

    const ru = await this.getRemnawaveUser(subscriptionId);
    if (ru) {
      if (subscription.isAntiThrottling && dataLimitGb && dataLimitGb > 0) {
        // Антиглушилка: добавляем трафик
        const currentLimit = ru.trafficLimitBytes ?? 0;
        const addBytes = dataLimitGb * 1024 * 1024 * 1024;
        await this.remnawaveApi.updateUser({
          uuid: ru.uuid,
          trafficLimitBytes: currentLimit + addBytes,
          status: 'ACTIVE',
        });
        this.logger.log(
          `Subscription ${subscriptionId} (anti-throttling) data limit extended by ${dataLimitGb} GB`,
        );
      } else {
        // Стандарт: продлеваем expire
        const currentExpire = ru.expireAt ? new Date(ru.expireAt) : null;
        const now = new Date();
        const base = currentExpire && currentExpire > now ? currentExpire : now;
        const newExpire = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

        await this.remnawaveApi.updateUser({
          uuid: ru.uuid,
          expireAt: newExpire.toISOString(),
          status: 'ACTIVE',
        });
        this.logger.log(
          `Subscription ${subscriptionId} extended by ${days} days — new expire ${newExpire.toISOString()}`,
        );
      }

      // Обновляем поля если отсутствуют
      if (!subscription.remnawaveUuid) {
        subscription.remnawaveUuid = ru.uuid;
      }
      if (!subscription.shortUuid) {
        subscription.shortUuid = ru.shortUuid;
      }
    } else {
      this.logger.warn(`Subscription ${subscriptionId} has no Remnawave user, skipping panel update`);
    }

    await this.subscriptionRepo.save(subscription);
    return subscription;
  }

  // ─── Истечение ───

  async processExpiredSubscriptions(): Promise<{
    expired: number;
    usernamesExpired: string[];
  }> {
    const remnawaveMap = await this.fetchRemnawaveUserMap();

    const usernamesExpired = Array.from(remnawaveMap.values())
      .filter((u) => u.status === 'EXPIRED' || u.status === 'DISABLED')
      .map((u) => u.username);

    this.logger.log(
      `Remnawave expired/disabled users: ${usernamesExpired.length}`,
    );

    return { expired: usernamesExpired.length, usernamesExpired };
  }

  // ─── Синхронизация ───

  /** Подписки без привязки к Remnawave */
  async getUnsynced(): Promise<Subscription[]> {
    return this.subscriptionRepo
      .createQueryBuilder('s')
      .where('s.username = :empty OR s.username IS NULL', { empty: '' })
      .orderBy('s.createdAt', 'DESC')
      .getMany();
  }

  /** Создать Remnawave-пользователей для всех подписок без username */
  async syncUnsynced(): Promise<{ synced: number; failed: number; errors: string[] }> {
    const unsynced = await this.getUnsynced();
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const sub of unsynced) {
      if (!this.remnawaveApi.isConfigured()) {
        errors.push(`${sub.id}: Remnawave not configured`);
        failed++;
        continue;
      }

      const panelUsername = this.buildPanelUsername(sub.id);
      const startTs = new Date(sub.startDate).getTime();
      const expireDate = new Date(startTs + sub.days * 24 * 60 * 60 * 1000);
      const squadUuid = this.remnawaveApi.getSquadUuid(sub.isAntiThrottling);
      const tag = this.remnawaveApi.getTag(sub.isAntiThrottling);

      try {
        const user = await this.remnawaveApi.createUser({
          username: panelUsername,
          expireAt: expireDate.toISOString(),
          trafficLimitBytes: 0,
          trafficLimitStrategy: 'NO_RESET',
          status: 'ACTIVE',
          description: sub.id,
          tag,
          activeInternalSquads: squadUuid ? [squadUuid] : [],
        });

      sub.username = panelUsername;
        sub.remnawaveUuid = user.uuid;
        sub.shortUuid = user.shortUuid;
        await this.subscriptionRepo.save(sub);
        synced++;
        this.logger.log(`Synced subscription ${sub.id} → "${panelUsername}" (${user.uuid})`);
      } catch (error) {
        failed++;
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${sub.id}: ${msg}`);
        this.logger.warn(`Failed to sync ${sub.id}: ${msg}`);
      }
    }

    this.logger.log(`Sync complete: ${synced} synced, ${failed} failed`);
    return { synced, failed, errors };
  }

  // ─── Удаление ───

  async deleteSubscription(subscriptionId: string): Promise<{
    deleted: boolean;
    marzbanDeleted: boolean;
  }> {
    const subscription = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    let marzbanDeleted = false;
    if (subscription.remnawaveUuid) {
      try {
        marzbanDeleted = await this.remnawaveApi.deleteUser(subscription.remnawaveUuid);
      } catch (error) {
        this.logger.warn(`Failed to delete Remnawave user "${subscription.remnawaveUuid}":`, error);
      }
    } else if (subscription.username) {
      try {
        const ru = await this.remnawaveApi.getUserByUsername(subscription.username);
        if (ru) {
          marzbanDeleted = await this.remnawaveApi.deleteUser(ru.uuid);
        }
      } catch (error) {
        this.logger.warn(`Failed to delete Remnawave user by username "${subscription.username}":`, error);
      }
    }

    await this.subscriptionRepo.remove(subscription);
    this.logger.log(`Subscription ${subscriptionId} deleted (Remnawave: ${marzbanDeleted ? 'removed' : 'not found / error'})`);

    return { deleted: true, marzbanDeleted };
  }

  // ─── HWID лимит устройств ───

  /**
   * Обновить лимит устройств (hwidDeviceLimit) в Remnawave для конкретной подписки.
   */
  async updateHwidDeviceLimit(subscriptionId: string, newLimit: number): Promise<void> {
    const subscription = await this.subscriptionRepo.findOne({ where: { id: subscriptionId } });
    if (!subscription) throw new NotFoundException('Subscription not found');

    const userUuid = subscription.remnawaveUuid;
    if (!userUuid) {
      this.logger.warn(`Subscription ${subscriptionId} has no remnawaveUuid, skipping hwidDeviceLimit update`);
      return;
    }

    await this.remnawaveApi.updateUser({ uuid: userUuid, hwidDeviceLimit: newLimit });
    this.logger.log(`Subscription ${subscriptionId}: hwidDeviceLimit updated to ${newLimit}`);
  }
}
