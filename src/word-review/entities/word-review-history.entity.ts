import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('word_review_history')
@Index(['wordId', 'sentAt'])
export class WordReviewHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  wordId: number;

  @Column({ type: 'varchar', length: 255 })
  word: string;

  @Column({ type: 'text' })
  translation: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  partOfSpeech: string | null;

  @Column({ type: 'varchar', length: 16 })
  source: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'int', nullable: true })
  messageId: number | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;
}
