import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn({ type: 'bigint' })
  maxId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  firstName: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  username: string | null = null;

  @Column({ type: 'boolean', default: false })
  isAdmin: boolean = false;

  @Column({ type: 'boolean', default: true })
  isActive: boolean = true;

  @Index('idx_user_access_token', { unique: true })
  @Column({ type: 'uuid', nullable: true, unique: true })
  accessToken: string | null = null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

