import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface BotButton {
  text: string;
  callbackData?: string;
  url?: string;
}

@Entity('bot_pages')
export class BotPage {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Уникальный ключ страницы, используемый в коде бота */
  @Column({ type: 'varchar', length: 100, unique: true })
  key!: string;

  /** Отображаемое название в панели управления */
  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** HTML-текст сообщения (поддерживает {{переменные}}) */
  @Column({ type: 'text', default: '' })
  text!: string;

  /** Тип медиа: none | photo | video */
  @Column({ type: 'varchar', length: 20, default: 'none' })
  mediaType!: 'none' | 'photo' | 'video';

  /** Путь к медиафайлу на сервере */
  @Column({ type: 'varchar', length: 500, nullable: true })
  mediaPath!: string | null;

  /** Telegram file_id (кэш после первой отправки) */
  @Column({ type: 'varchar', length: 300, nullable: true })
  mediaTelegramFileId!: string | null;

  /** JSON: BotButton[][] — строки кнопок */
  @Column({ type: 'jsonb', default: [] })
  buttons!: BotButton[][];

  /** Порядок отображения в списке */
  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  /** Описание для администратора */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
