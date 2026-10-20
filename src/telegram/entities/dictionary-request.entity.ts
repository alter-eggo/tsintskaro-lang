import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface DictionaryRequestPart {
  messageId: number;
  text: string;
  addressed?: boolean;
  clarification?: boolean;
}

/** Retain the original input even after cancellation or successful application. */
@Entity('dictionary_request')
@Index(['scope', 'firstMessageId'], { unique: true })
export class DictionaryRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  scope: string;

  @Column({ type: 'bigint' })
  firstMessageId: number;

  @Column({ type: 'jsonb' })
  parts: DictionaryRequestPart[];

  @Column({ type: 'int', default: 1 })
  revision: number;

  @Column({ type: 'varchar', length: 16, default: 'collecting' })
  status: 'collecting' | 'ready' | 'applied' | 'cancelled';

  @Column({ type: 'text', nullable: true })
  question: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
