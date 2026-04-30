import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

export type PollDirection = 'ru_to_ts' | 'ts_to_ru';

@Entity('poll_history')
@Index(['word', 'sentAt'])
export class PollHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 128 })
  word: string;

  @Column({ type: 'varchar', length: 16 })
  direction: PollDirection;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  pollId: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  sentAt: Date;
}
