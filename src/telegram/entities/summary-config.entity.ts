import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('summary_config')
export class SummaryConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'varchar', length: 64 })
  setBy: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  setAt: Date;
}
