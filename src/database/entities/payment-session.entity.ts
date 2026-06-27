import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'expired';

@Entity('payment_sessions')
@Index('idx_payment_status', ['status'])
@Index('idx_payment_expires_at', ['expiresAt'])
@Index('idx_payment_max_id', ['maxId'])
export class PaymentSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'bigint', unique: true })
  invId!: string;

  @Column({ type: 'bigint' })
  maxId!: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status!: PaymentStatus;

  @Column({ type: 'int' })
  period!: number;

  @Column({ type: 'int' })
  amount!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null = null;

  /** ID подписки в нашей БД (если платёж — на продление конкретной подписки) */
  @Column({ type: 'uuid', nullable: true })
  subscriptionId: string | null = null;

  /** Флаг: создать новую подписку (не продлевать существующую активную) */
  @Column({ type: 'boolean', default: false })
  forceNewSubscription: boolean = false;

  /** max ID реферера (кто пригласил покупателя) */
  @Column({ type: 'varchar', length: 255, nullable: true })
  referrerId: string | null = null;

  /** Метаданные плана (dataLimitGB, proxies, inbounds, planType) */
  @Column({ type: 'text', nullable: true })
  planMetadata: string | null = null;

  /** Внутренний ID заказа в FreeKassa (из ответа orders/create) */
  @Column({ type: 'bigint', nullable: true })
  fkOrderId: string | null = null;
}

