import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  CreateDateColumn,
} from 'typeorm';

export type WordSource = 'etalon' | 'rabochy' | 'chat';

@Entity('word')
export class Word {
  @PrimaryGeneratedColumn()
  id: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  word: string;

  @Column({ type: 'text' })
  translation: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  partOfSpeech: string | null;

  @Column({ type: 'text', nullable: true })
  comments: string | null;

  @Column({ type: 'varchar', length: 16 })
  source: WordSource;

  @Column({ type: 'varchar', length: 128, nullable: true })
  addedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
