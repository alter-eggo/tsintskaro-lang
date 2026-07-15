import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

export type WordReviewBatchStatus = 'active' | 'completed';

@Entity('word_review_batch')
@Index(['chatId', 'status'])
export class WordReviewBatch {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'int', nullable: true })
  messageId: number | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: WordReviewBatchStatus;

  @Column({ type: 'int', default: 3 })
  requiredVotes: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
