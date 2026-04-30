import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('summary_report')
export class SummaryReport {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  sourceChatId: number;

  @Column({ type: 'int', nullable: true })
  sourceThreadId: number | null;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  targetChatId: number;

  @Column({ type: 'int', nullable: true })
  targetThreadId: number | null;

  @Column({ type: 'int' })
  messageCount: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  extractedWords: unknown[];

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  discussionResult: Record<string, unknown>;

  @Column({ type: 'text' })
  reportText: string;

  @Column({ type: 'text', nullable: true })
  discussionSummary: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
