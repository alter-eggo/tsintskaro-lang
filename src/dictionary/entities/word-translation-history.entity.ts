import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

@Entity('word_translation_history')
@Index(['wordId', 'createdAt'])
export class WordTranslationHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  wordId: number;

  @Column({ type: 'varchar', length: 255 })
  word: string;

  @Column({ type: 'text' })
  previousTranslation: string;

  @Column({ type: 'text' })
  translation: string;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ type: 'varchar', length: 128, nullable: true })
  username: string | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'int', nullable: true })
  messageId: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
