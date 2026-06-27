import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan, In, Between } from 'typeorm';
import { PaymentSession } from '@database/entities';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentSession)
    private readonly paymentRepository: Repository<PaymentSession>,
  ) {}

  /**
   * Добавить месяцы к текущей дате + 1 день запаса
   */
  private addMonthsPlusOneDay(months: number): Date {
    const date = new Date();
    date.setMonth(date.getMonth() + months);
    date.setDate(date.getDate() + 1);
    return date;
  }

  /**
   * Создать сессию платежа
   */
  async createSession(dto: CreatePaymentDto): Promise<PaymentSession> {
    // FreeKassa API принимает orderId только в диапазоне signed int32 (макс 2 147 483 647).
    // Генерируем случайный 9-значный ID; при коллизии повторяем попытку.
    let invId: string;
    let attempts = 0;
    while (true) {
      invId = (Math.floor(Math.random() * 2_000_000_000) + 1).toString();
      const existing = await this.paymentRepository.findOne({ where: { invId } });
      if (!existing) break;
      if (++attempts > 10) throw new Error('Failed to generate unique invId after 10 attempts');
    }

    // Истечение
    const expiresAt = dto.ttlMinutes
      ? new Date(Date.now() + dto.ttlMinutes * 60_000)
      : null;

    const session = this.paymentRepository.create({
      invId,
      maxId: dto.maxId,
      period: dto.period,
      amount: dto.amount,
      status: 'pending',
      expiresAt,
      subscriptionId: dto.subscriptionId ?? null,
      forceNewSubscription: dto.forceNewSubscription ?? false,
      referrerId: dto.referrerId ?? null,
      planMetadata: dto.planMetadata ?? null,
    });

    const saved = await this.paymentRepository.save(session);
    this.logger.log(`Created payment session: ${saved.id} for user ${dto.maxId}`);

    return saved;
  }

  /**
   * Пометить платёж как оплаченный
   */
  async markPaid(invId: string): Promise<PaymentSession | null> {
    const session = await this.paymentRepository.findOne({ where: { invId } });

    if (!session) {
      this.logger.warn(`Payment session not found: ${invId}`);
      return null;
    }

    // Идемпотентность: если уже оплачено — просто возвращаем
    if (session.status === 'paid') {
      this.logger.log(`Payment already processed: ${invId}`);
      return session;
    }

    session.status = 'paid';

    const saved = await this.paymentRepository.save(session);
    this.logger.log(`Payment marked as paid: ${invId}`);

    return saved;
  }

  /**
   * Найти платёж по invId
   */
  async findByInvId(invId: string): Promise<PaymentSession | null> {
    return this.paymentRepository.findOne({ where: { invId } });
  }

  /**
   * Найти платёж по FK внутреннему orderId (intid из вебхука)
   */
  async findByFkOrderId(fkOrderId: string): Promise<PaymentSession | null> {
    return this.paymentRepository.findOne({ where: { fkOrderId } });
  }

  /**
   * Сохранить FK внутренний orderId в сессию
   */
  async setFkOrderId(invId: string, fkOrderId: string): Promise<void> {
    await this.paymentRepository.update({ invId }, { fkOrderId });
  }

  /**
   * Очистить просроченные pending сессии
   */
  async cleanupExpiredSessions(): Promise<number> {
    const result = await this.paymentRepository.update(
      {
        status: 'pending',
        expiresAt: LessThan(new Date()),
      },
      { status: 'expired' },
    );

    const affected = result.affected || 0;
    if (affected > 0) {
      this.logger.log(`Cleaned up ${affected} expired sessions`);
    }

    return affected;
  }

  /**
   * Удалить истекшие и неоплаченные payment sessions
   * Оплаченные sessions сохраняются навсегда
   */
  async deleteExpiredSessions(): Promise<number> {
    const result = await this.paymentRepository.delete({
      expiresAt: LessThan(new Date()),
      status: In(['pending', 'expired', 'failed']), // НЕ удаляем 'paid'
    });

    const affected = result.affected || 0;
    if (affected > 0) {
      this.logger.log(`Deleted ${affected} expired unpaid payment sessions`);
    }

    return affected;
  }

  /**
   * Получить ВСЕ оплаченные payment sessions без пагинации (для экспорта)
   */
  async getAllPaidSessions(dateFrom?: Date, dateTo?: Date): Promise<PaymentSession[]> {
    const where: any = { status: 'paid' };

    if (dateFrom && dateTo) {
      where.createdAt = Between(dateFrom, dateTo);
    } else if (dateFrom) {
      where.createdAt = MoreThan(dateFrom);
    } else if (dateTo) {
      where.createdAt = LessThan(dateTo);
    }

    return this.paymentRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Получить все оплаченные payment sessions с фильтрацией по датам и пагинацией
   */
  async getPaidSessions(
    dateFrom?: Date,
    dateTo?: Date,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: PaymentSession[]; total: number; page: number; totalPages: number }> {
    const where: any = { status: 'paid' };

    if (dateFrom && dateTo) {
      where.createdAt = Between(dateFrom, dateTo);
    } else if (dateFrom) {
      where.createdAt = MoreThan(dateFrom);
    } else if (dateTo) {
      where.createdAt = LessThan(dateTo);
    }

    const [sessions, total] = await this.paymentRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const totalPages = Math.ceil(total / limit);

    this.logger.log(`Found ${sessions.length} paid sessions (page ${page}/${totalPages}, total: ${total})`);
    
    return {
      data: sessions,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Получить случайную выборку из оплаченных payment sessions
   */
  async getRandomPaidSessions(
    count: number,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<PaymentSession[]> {
    const where: any = { status: 'paid' };

    if (dateFrom && dateTo) {
      where.createdAt = Between(dateFrom, dateTo);
    } else if (dateFrom) {
      where.createdAt = MoreThan(dateFrom);
    } else if (dateTo) {
      where.createdAt = LessThan(dateTo);
    }

    // Получаем все записи без пагинации для случайного отбора
    const allSessions = await this.paymentRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });

    // Если запрошено больше, чем есть - возвращаем все
    if (count >= allSessions.length) {
      return allSessions;
    }

    // Случайный отбор
    const shuffled = [...allSessions].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, count);

    this.logger.log(`Selected ${selected.length} random paid sessions from ${allSessions.length} total`);
    return selected;
  }
}

