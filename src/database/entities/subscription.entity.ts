import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SubscriptionSource {
  ADMIN = 'admin',
  BOT = 'bot',
}

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Username в Remnawave (subscription.id без дефисов) */
  @Index('idx_subscription_username', { unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null = null;

  /** UUID пользователя в Remnawave */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  remnawaveUuid: string | null = null;

  /** Короткий UUID из Remnawave — используется для URL подписки */
  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  shortUuid: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  telegramId: string | null = null;

  /** Пользовательское название подписки */
  @Column({ type: 'varchar', length: 30, nullable: true, default: null })
  name: string | null = null;

  @Column({
    type: 'enum',
    enum: SubscriptionSource,
    default: SubscriptionSource.ADMIN,
  })
  source!: SubscriptionSource;

  /** Суммарный купленный период в днях */
  @Column({ type: 'int' })
  days!: number;

  /** Тип подписки: антиглушилка (true) или стандарт (false) */
  @Column({ type: 'boolean', default: false })
  isAntiThrottling!: boolean;

  /** Дополнительная подписка (не является основной Базовый/Антиглушилка) */
  @Column({ type: 'boolean', default: false })
  isAdditional: boolean = false;

  /** Telegram ID реферера */
  @Column({ type: 'varchar', length: 255, nullable: true })
  referrerId: string | null = null;

  @Column({ type: 'timestamptz' })
  startDate!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
