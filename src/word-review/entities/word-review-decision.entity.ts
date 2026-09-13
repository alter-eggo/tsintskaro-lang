import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface WordReviewDecisionChange {
  itemId: number;
  wordId: number;
  word: string;
  previousStatus: string;
  status: 'confirmed' | 'disputed';
}

const bigintTransformer = {
  to: (value: number) => value,
  from: (value: string) => Number(value),
};

@Entity('word_review_decision')
@Index(['chatId', 'messageId'], { unique: true })
@Index(['batchId', 'createdAt'])
export class WordReviewDecision {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  batchId: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'int' })
  messageId: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  username: string | null;

  @Column({ type: 'jsonb' })
  changes: WordReviewDecisionChange[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
