import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionsService } from '@modules/subscriptions';
import { PaymentsService } from '@modules/payments';
import { Subscription } from '@database/entities';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsService: PaymentsService,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

  /**
   * Очистка просроченных платёжных сессий. Каждый день в 03:00.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredSessions() {
    this.logger.log('Running scheduled task: Cleanup expired payment sessions');

    try {
      const deletedSessions = await this.paymentsService.deleteExpiredSessions();
      if (deletedSessions > 0) {
        this.logger.log(`Deleted ${deletedSessions} expired payment sessions`);
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired sessions:', error);
    }
  }

  /**
   * Уведомление о скором окончании подписки. Выполняется каждый день в 10:00.
   * Получает пользователей из Remnawave, фильтрует истекающих в течение 2 дней.
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async notifyExpiringSubscriptions() {
    this.logger.log('Running scheduled task: Notify expiring subscriptions');

    try {
      const remnawaveMap = await this.subscriptionsService.fetchRemnawaveUserMap();
      const allSubs = await this.subscriptionRepo.find();

      const nowMs = Date.now();
      const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

      let notified = 0;
      let failed = 0;

      for (const sub of allSubs) {
        if (!sub.maxId || !sub.username) continue;

        const ru = remnawaveMap.get(sub.username);
        if (!ru || ru.status !== 'ACTIVE') continue;
        if (!ru.expireAt) continue;

        const expireMs = new Date(ru.expireAt).getTime();
        if (expireMs - nowMs <= twoDaysMs && expireMs > nowMs) {
          const endDate = new Date(ru.expireAt);
          // TODO: Отправка уведомления пользователю о скором окончании подписки.
          // if (success) notified++;
          // else failed++;

          await new Promise((r) => setTimeout(r, 100));
        }
      }

      this.logger.log(
        `Expiring notifications sent: ${notified} successful, ${failed} failed`,
      );
    } catch (error) {
      this.logger.error('Error sending expiring notifications:', error);
    }
  }
}
