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

@Entity('bot_memory')
@Index(['chatId', 'createdAt'])
export class BotMemory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ name: 'memory_key', type: 'varchar', length: 64, nullable: true })
  memoryKey: string | null;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'varchar', length: 128, nullable: true })
  createdBy: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  updatedBy: string | null;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
