import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('openai_usage_report_config')
export class OpenaiUsageReportConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  recipientUsername: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  setBy: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  setAt: Date;
}
