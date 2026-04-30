import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { CollectedMessage } from './entities/collected-message.entity';
import { SummaryConfig } from './entities/summary-config.entity';
import { SummaryReport } from './entities/summary-report.entity';

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
