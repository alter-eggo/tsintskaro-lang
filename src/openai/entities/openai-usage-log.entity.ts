import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('openai_usage_log')
@Index(['createdAt'])
@Index(['purpose', 'createdAt'])
export class OpenaiUsageLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 64 })
  purpose: string;

  @Column({ type: 'varchar', length: 512 })
  detail: string;

  @Column({ type: 'varchar', length: 128 })
  model: string;

  @Column({ type: 'int', default: 0 })
  promptTokens: number;

  @Column({ type: 'int', default: 0 })
  completionTokens: number;

  @Column({ type: 'int', default: 0 })
  totalTokens: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  rawUsage: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
