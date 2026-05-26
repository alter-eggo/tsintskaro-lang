import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

@Entity('fact_day_config')
export class FactDayConfig {
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

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 0 })
  nextFactIndex: number;

  @Column({ type: 'date', nullable: true })
  lastSentDate: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  lastSentSlot: string | null;

  @Column({ type: 'int', nullable: true })
  lastFactNumber: number | null;
}
