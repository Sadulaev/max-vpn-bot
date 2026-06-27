import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionsService } from '@modules/subscriptions';
import { PaymentsService } from '@modules/payments';
import { MaxApiService } from '@modules/max-api';
import type { NewMessageBody } from '@modules/max-api';
import { Subscription } from '@database/entities';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly paymentsService: PaymentsService,
    private readonly maxApiService: MaxApiService,
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
          try {
            if (sub.maxId && this.maxApiService.isConfigured()) {
              const userId = parseInt(sub.maxId, 10);
              if (!isNaN(userId)) {
                const daysLeft = Math.ceil((expireMs - nowMs) / (24 * 60 * 60 * 1000));
                const body: NewMessageBody = {
                  text:
                    `⚠️ **Подписка скоро закончится!**\n\n` +
                    `Ваша подписка истекает ${endDate.toLocaleDateString('ru-RU')} (через ${daysLeft} дн.).\n\n` +
                    `Продлите подписку, чтобы не потерять доступ.`,
                  format: 'markdown',
                  attachments: [
                    {
                      type: 'inline_keyboard',
                      payload: {
                        buttons: [
                          [{ type: 'callback', text: '— Продлить подписку —', payload: 'buy_sub' }],
                          [{ type: 'callback', text: '◀️ Главное меню', payload: 'main_menu' }],
                        ],
                      },
                    },
                  ],
                };
                await this.maxApiService.sendMessage(userId, body);
                notified++;
              }
            }
          } catch {
            failed++;
          }

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
