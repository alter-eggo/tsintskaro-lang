import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollConfig } from './entities/poll-config.entity';

@Injectable()
export class PollConfigService {
  private readonly logger = new Logger(PollConfigService.name);

  constructor(
    @InjectRepository(PollConfig)
    private readonly repo: Repository<PollConfig>,
  ) {}

  async get(): Promise<PollConfig | null> {
    const configs = await this.repo.find({ order: { setAt: 'DESC' }, take: 1 });
    return configs[0] ?? null;
  }

  async set(
    chatId: number,
    threadId: number | null,
    setBy: string,
  ): Promise<PollConfig> {
    await this.repo.clear();
    const entity = this.repo.create({
      chatId,
      threadId,
      setBy,
      setAt: new Date(),
    });
    const saved = await this.repo.save(entity);
    this.logger.log(
      `Poll target set: chat=${chatId}, thread=${threadId ?? 'none'}, by=${setBy}`,
    );
    return saved;
  }

  async clear(): Promise<void> {
    await this.repo.clear();
    this.logger.log('Poll target cleared');
  }
}
