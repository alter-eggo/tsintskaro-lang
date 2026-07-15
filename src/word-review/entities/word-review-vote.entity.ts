import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('word_review_vote')
@Index(['itemId', 'userId', 'revision'], { unique: true })
export class WordReviewVote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  itemId: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  userId: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  @Column({ type: 'int' })
  revision: number;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
