import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MediaType = 'none' | 'photo' | 'video';

export interface BotButton {
  text: string;
  callbackData?: string;
  url?: string;
}

@Entity('bot_pages')
export class BotPage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 128, unique: true })
  key!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ type: 'text', default: '' })
  text!: string;

  @Column({ type: 'varchar', length: 16, default: 'none' })
  mediaType!: MediaType;

  @Column({ type: 'varchar', length: 512, nullable: true })
  mediaPath: string | null = null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mediaTelegramFileId: string | null = null;

  @Column({ type: 'jsonb', default: [] })
  buttons!: BotButton[][];

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
