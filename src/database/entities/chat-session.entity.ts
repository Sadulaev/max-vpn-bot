import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  sessionId: string;

  @Column({ default: 0 })
  messageCount: number;

  @Column({ default: 0 })
  dailyMessageCount: number;

  @Column({ type: 'date', nullable: true })
  lastMessageDate: string;

  @CreateDateColumn()
  createdAt: Date;
}
