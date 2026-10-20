import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const bigintTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value !== null ? Number(value) : null),
};

export type BotEventRoute =
  | 'chat'
  | 'bot'
  | 'review'
  | 'draft'
  | 'model'
  | 'error';

/** Why the bot answered or stayed silent. Admins read it with /botlog. */
@Entity('bot_event')
@Index(['chatId', 'threadId', 'createdAt'])
export class BotEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'bigint', transformer: bigintTransformer })
  chatId: number;

  @Column({ type: 'int', nullable: true })
  threadId: number | null;

  @Column({ type: 'bigint', transformer: bigintTransformer, nullable: true })
  messageId: number | null;

  @Column({ type: 'varchar', length: 128 })
  username: string;

  @Column({ type: 'varchar', length: 120, default: '' })
  preview: string;

  @Column({ type: 'varchar', length: 16 })
  route: BotEventRoute;

  @Column({ type: 'text' })
  detail: string;

  @Column({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;
}
