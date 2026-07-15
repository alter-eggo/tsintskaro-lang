import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('word_review_correction_request')
@Index(['chatId', 'promptMessageId', 'userId'])
export class WordReviewCorrectionRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  itemId: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  @Column({ type: 'int' })
  promptMessageId: number;

  @Column({ type: 'int' })
  revision: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;
}
