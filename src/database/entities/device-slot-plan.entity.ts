import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Тарифный план для покупки дополнительных слотов устройств.
 * Позволяет увеличить лимит HWID-устройств на подписке сверх базовых 5.
 */
@Entity('device_slot_plans')
export class DeviceSlotPlan {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Отображаемое название, напр. "+1 устройство" */
  @Column({ type: 'varchar', length: 255 })
  label!: string;

  /** Количество слотов, которое добавляется */
  @Column({ type: 'int' })
  slotsCount!: number;

  /** Цена в рублях */
  @Column({ type: 'int' })
  price!: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  @Column({ type: 'int', default: 0 })
  sortOrder: number = 0;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
