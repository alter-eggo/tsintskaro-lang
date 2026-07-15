import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type WordReviewItemStatus =
  | 'voting'
  | 'awaiting_correction'
  | 'confirming'
  | 'confirmed';

@Entity('word_review_item')
@Index(['batchId', 'position'], { unique: true })
export class WordReviewItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  batchId: number;

  @Column({ type: 'int' })
  wordId: number;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'varchar', length: 255 })
  originalWord: string;

  @Column({ type: 'text' })
  originalTranslation: string;

  @Column({ type: 'varchar', length: 255 })
  proposedWord: string;

  @Column({ type: 'text' })
  proposedTranslation: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  partOfSpeech: string | null;

  @Column({ type: 'varchar', length: 16 })
  source: string;

  @Column({ type: 'varchar', length: 24, default: 'voting' })
  status: WordReviewItemStatus;

  @Column({ type: 'int', default: 1 })
  revision: number;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;
}
