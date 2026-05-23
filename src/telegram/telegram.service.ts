import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { CollectedMessage } from './entities/collected-message.entity';
import { SummaryConfig } from './entities/summary-config.entity';
import { SummaryReport } from './entities/summary-report.entity';
import { BotMemory } from './entities/bot-memory.entity';

export const GLOBAL_BOT_MEMORY_CHAT_ID = 0;
const DEFAULT_WORKING_LINKS_MEMORY_KEY = 'working-links-site-rule';
const DEFAULT_GLOBAL_MEMORIES = [
  {
    memoryKey: DEFAULT_WORKING_LINKS_MEMORY_KEY,
    text:
      'Если пользователь просит скинуть рабочие ссылки, нужно прислать ссылку на сайт. ' +
      'Точный URL сайта хранится отдельной записью памяти с пометкой "Сайт:".',
  },
  {
    memoryKey: 'working-links-site-url',
    text: 'Сайт: https://tsintskaro.vercel.app',
  },
] as const;

interface CreateSummaryReportParams {
  sourceChatId: number;
  sourceThreadId: number | null;
  targetChatId: number;
  targetThreadId: number | null;
  messageCount: number;
  extractedWords: unknown[];
  discussionResult: Record<string, unknown>;
  reportText: string;
  discussionSummary: string | null;
  createdBy: string | null;
}

export interface BotMemoryEntry {
  id: number;
  chatId: number;
  threadId: number | null;
  text: string;
  createdBy: string | null;
  createdAt: Date;
  updatedBy: string | null;
  updatedAt: Date;
  memoryKey: string | null;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @InjectRepository(CollectedMessage)
    private readonly messageRepo: Repository<CollectedMessage>,
    @InjectRepository(SummaryConfig)
    private readonly summaryConfigRepo: Repository<SummaryConfig>,
    @InjectRepository(SummaryReport)
    private readonly summaryReportRepo: Repository<SummaryReport>,
    @InjectRepository(BotMemory)
    private readonly botMemoryRepo: Repository<BotMemory>,
  ) {}

  async addMessage(
    chatId: number,
    threadId: number | null,
    telegramMessageId: number | null,
    text: string,
    username: string,
    sentAt: Date,
  ): Promise<number> {
    const entity = this.messageRepo.create({
      chatId,
      threadId,
      telegramMessageId,
      text,
      username,
      sentAt,
    });
    await this.messageRepo.save(entity);
    return this.getCount(chatId);
  }

  async getActiveMessages(chatId: number): Promise<CollectedMessage[]> {
    return this.messageRepo.find({
      where: { chatId, reportId: IsNull(), clearedAt: IsNull() },
      order: { sentAt: 'ASC', id: 'ASC' },
    });
  }

  async getMessagesText(chatId: number): Promise<string[]> {
    const buffer = await this.getActiveMessages(chatId);
    return buffer.map((m) => m.text);
  }

  async getMessages(
    chatId: number,
  ): Promise<{ text: string; username: string }[]> {
    const buffer = await this.getActiveMessages(chatId);
    return buffer.map((m) => ({ text: m.text, username: m.username }));
  }

  async clearBuffer(chatId: number): Promise<void> {
    await this.messageRepo.update(
      { chatId, reportId: IsNull(), clearedAt: IsNull() },
      { clearedAt: new Date() },
    );
  }

  async getCount(chatId: number): Promise<number> {
    return this.messageRepo.count({
      where: { chatId, reportId: IsNull(), clearedAt: IsNull() },
    });
  }

  async getRecentMessages(
    chatId: number,
    threadId: number | null,
    limit = 50,
  ): Promise<{ username: string; text: string; sentAt: Date }[]> {
    const where = threadId != null ? { chatId, threadId } : { chatId };
    const rows = await this.messageRepo.find({
      where,
      order: { sentAt: 'DESC', id: 'DESC' },
      take: limit,
      select: { username: true, text: true, sentAt: true },
    });
    // Return in chronological order (oldest first) for natural reading
    return rows.reverse().map((m) => ({
      username: m.username,
      text: m.text,
      sentAt: m.sentAt,
    }));
  }

  async addBotMemory(
    chatId: number,
    threadId: number | null,
    text: string,
    createdBy: string | null,
  ): Promise<BotMemory> {
    const entity = this.botMemoryRepo.create({
      chatId,
      threadId,
      memoryKey: null,
      text: text.trim(),
      active: true,
      createdBy,
      updatedBy: createdBy,
    });
    const saved = await this.botMemoryRepo.save(entity);
    this.logger.log(
      `Bot memory added: chat=${chatId}, thread=${threadId ?? 'none'}, by=${createdBy ?? 'unknown'}`,
    );
    return saved;
  }

  async getBotMemory(chatId: number, limit = 50): Promise<BotMemoryEntry[]> {
    const rows = await this.getVisibleBotMemoryRows(chatId, limit);
    return rows.map((m) => this.toBotMemoryEntry(m));
  }

  async listBotMemory(chatId: number, limit = 50): Promise<BotMemoryEntry[]> {
    const rows = await this.getVisibleBotMemoryRows(chatId, limit);
    return rows.map((m) => this.toBotMemoryEntry(m));
  }

  async updateBotMemory(
    chatId: number,
    id: number,
    text: string,
    updatedBy: string | null,
  ): Promise<BotMemoryEntry | null> {
    await this.ensureDefaultGlobalMemory();
    const entry = await this.botMemoryRepo.findOne({
      where: [
        { id, chatId, active: true },
        { id, chatId: GLOBAL_BOT_MEMORY_CHAT_ID, active: true },
      ],
    });
    if (!entry) return null;

    entry.text = text.trim();
    entry.updatedBy = updatedBy;
    const saved = await this.botMemoryRepo.save(entry);
    this.logger.log(
      `Bot memory #${id} updated: chat=${entry.chatId}, by=${updatedBy ?? 'unknown'}`,
    );
    return this.toBotMemoryEntry(saved);
  }

  async deleteBotMemory(
    chatId: number,
    id: number,
    updatedBy: string | null,
  ): Promise<boolean> {
    await this.ensureDefaultGlobalMemory();
    const entry = await this.botMemoryRepo.findOne({
      where: [
        { id, chatId, active: true },
        { id, chatId: GLOBAL_BOT_MEMORY_CHAT_ID, active: true },
      ],
    });
    if (!entry) return false;

    entry.active = false;
    entry.updatedBy = updatedBy;
    await this.botMemoryRepo.save(entry);
    this.logger.log(
      `Bot memory #${id} disabled: chat=${entry.chatId}, by=${updatedBy ?? 'unknown'}`,
    );
    return true;
  }

  private async getVisibleBotMemoryRows(
    chatId: number,
    limit: number,
  ): Promise<BotMemory[]> {
    await this.ensureDefaultGlobalMemory();
    const [globalRows, chatRows] = await Promise.all([
      this.botMemoryRepo.find({
        where: { chatId: GLOBAL_BOT_MEMORY_CHAT_ID, active: true },
        order: { createdAt: 'ASC', id: 'ASC' },
      }),
      this.botMemoryRepo.find({
        where: { chatId, active: true },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: limit,
      }),
    ]);

    return [...globalRows, ...chatRows].sort((a, b) => {
      const byDate = a.createdAt.getTime() - b.createdAt.getTime();
      return byDate !== 0 ? byDate : a.id - b.id;
    });
  }

  async ensureDefaultGlobalMemory(): Promise<void> {
    for (const defaultMemory of DEFAULT_GLOBAL_MEMORIES) {
      const existing = await this.botMemoryRepo.findOne({
        where: { memoryKey: defaultMemory.memoryKey },
      });
      if (existing) continue;

      await this.botMemoryRepo.save(
        this.botMemoryRepo.create({
          chatId: GLOBAL_BOT_MEMORY_CHAT_ID,
          threadId: null,
          memoryKey: defaultMemory.memoryKey,
          text: defaultMemory.text,
          active: true,
          createdBy: 'system',
          updatedBy: 'system',
        }),
      );
      this.logger.log(
        `Default global bot memory created: ${defaultMemory.memoryKey}`,
      );
    }
  }

  private toBotMemoryEntry(memory: BotMemory): BotMemoryEntry {
    return {
      id: memory.id,
      chatId: memory.chatId,
      threadId: memory.threadId,
      text: memory.text,
      createdBy: memory.createdBy,
      createdAt: memory.createdAt,
      updatedBy: memory.updatedBy,
      updatedAt: memory.updatedAt,
      memoryKey: memory.memoryKey,
    };
  }

  async setSummaryTarget(
    chatId: number,
    threadId: number | null,
    setBy: string,
  ): Promise<SummaryConfig> {
    await this.summaryConfigRepo.clear();
    const entity = this.summaryConfigRepo.create({
      chatId,
      threadId,
      setBy,
      setAt: new Date(),
    });
    const saved = await this.summaryConfigRepo.save(entity);
    this.logger.log(
      `Summary target set: chat=${chatId}, thread=${threadId ?? 'none'}, by=${setBy}`,
    );
    return saved;
  }

  async clearSummaryTarget(): Promise<void> {
    await this.summaryConfigRepo.clear();
    this.logger.log('Summary target cleared');
  }

  async getSummaryTarget(): Promise<SummaryConfig | null> {
    const configs = await this.summaryConfigRepo.find({
      order: { setAt: 'DESC' },
      take: 1,
    });
    return configs[0] ?? null;
  }

  async createSummaryReport(
    params: CreateSummaryReportParams,
  ): Promise<SummaryReport> {
    const report = this.summaryReportRepo.create(params);
    return this.summaryReportRepo.save(report);
  }

  async markMessagesReported(
    messageIds: number[],
    reportId: number,
  ): Promise<void> {
    if (messageIds.length === 0) return;
    await this.messageRepo.update({ id: In(messageIds) }, { reportId });
  }
}
