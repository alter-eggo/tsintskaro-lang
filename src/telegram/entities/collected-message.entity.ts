import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('collected_message')
@Index(['chatId', 'reportId', 'clearedAt'])
export class CollectedMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'bigint', transformer: bigintTransformer, nullable: true })
  telegramMessageId: number | null;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 128 })
  username: string;

  @Column({ type: 'timestamptz' })
  sentAt: Date;

  @Column({ type: 'int', nullable: true })
  reportId: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  clearedAt: Date | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
