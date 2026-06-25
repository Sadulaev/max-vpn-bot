import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PlanType = 'standard' | 'anti-throttling';

@Entity('plans')
export class Plan {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  planType!: PlanType;

  @Column({ type: 'varchar', length: 255 })
  label!: string;

  @Column({ type: 'int' })
  months!: number;

  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'int', default: 0 })
  dataLimitGB!: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null = null;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  /** true — основная подписка (Базовый / Антиглушилка), false — дополнительная */
  @Column({ type: 'boolean', default: true })
  isMain: boolean = true;

  @Column({ type: 'int', default: 0 })
  sortOrder: number = 0;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
