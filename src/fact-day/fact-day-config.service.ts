import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FactDayConfig } from './entities/fact-day-config.entity';

@Injectable()
export class FactDayConfigService {
  private readonly logger = new Logger(FactDayConfigService.name);

  constructor(
    @InjectRepository(FactDayConfig)
    private readonly repo: Repository<FactDayConfig>,
  ) {}

  async get(): Promise<FactDayConfig | null> {
    const configs = await this.repo.find({ order: { setAt: 'DESC' }, take: 1 });
    return configs[0] ?? null;
  }

  async set(
    chatId: number,
    threadId: number | null,
    setBy: string,
  ): Promise<FactDayConfig> {
    const existing = await this.get();
    if (existing) {
      existing.chatId = chatId;
      existing.threadId = threadId;
      existing.setBy = setBy;
      existing.setAt = new Date();
      existing.enabled = true;
      const saved = await this.repo.save(existing);
      this.logger.log(
        `Fact day target updated: chat=${chatId}, thread=${threadId ?? 'none'}, by=${setBy}`,
      );
      return saved;
    }

    const entity = this.repo.create({
      chatId,
      threadId,
      setBy,
      setAt: new Date(),
      enabled: true,
      nextFactIndex: 0,
      lastSentDate: null,
      lastSentSlot: null,
      lastFactNumber: null,
    });
    const saved = await this.repo.save(entity);
    this.logger.log(
      `Fact day target set: chat=${chatId}, thread=${threadId ?? 'none'}, by=${setBy}`,
    );
    return saved;
  }

  async enable(): Promise<FactDayConfig | null> {
    const target = await this.get();
    if (!target) return null;
    target.enabled = true;
    const saved = await this.repo.save(target);
    this.logger.log(
      `Fact day enabled: chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
    );
    return saved;
  }

  async disable(): Promise<FactDayConfig | null> {
    const target = await this.get();
    if (!target) return null;
    target.enabled = false;
    const saved = await this.repo.save(target);
    this.logger.log(
      `Fact day disabled: chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
    );
    return saved;
  }

  async markSent(
    configId: number,
    sentFactIndex: number,
    factsCount: number,
    sentDate: string,
    sentSlot: string,
  ): Promise<void> {
    await this.repo.update(configId, {
      nextFactIndex: (sentFactIndex + 1) % factsCount,
      lastSentDate: sentDate,
      lastSentSlot: sentSlot,
      lastFactNumber: sentFactIndex + 1,
    });
  }
}
