import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('word_edit_history')
export class WordEditHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  operation: string;

  @Column({ type: 'varchar', length: 160, nullable: true, unique: true })
  requestKey: string | null;

  @Column({ type: 'jsonb' })
  before: unknown;

  @Column({ type: 'jsonb' })
  after: unknown;

  @Column({ type: 'jsonb' })
  actor: {
    userId: number;
    username: string;
    chatId?: number;
    threadId?: number | null;
    messageId?: number | null;
  };

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
