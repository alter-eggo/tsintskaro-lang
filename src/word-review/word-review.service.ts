import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { IsNull, Not, Repository } from 'typeorm';
import { DictionaryService } from '../dictionary/dictionary.service';
import { Word } from '../dictionary/entities/word.entity';
import { WordReviewBatch } from './entities/word-review-batch.entity';
import { WordReviewConfig } from './entities/word-review-config.entity';
import { WordReviewCorrectionRequest } from './entities/word-review-correction-request.entity';
import { WordReviewHistory } from './entities/word-review-history.entity';
import { WordReviewItem } from './entities/word-review-item.entity';
import { WordReviewVote } from './entities/word-review-vote.entity';

export const DEFAULT_WORD_REVIEW_LIMIT = 10;
export const WORD_REVIEW_REQUIRED_VOTES = 3;

export interface WordReviewSendResult {
  status: 'sent' | 'no_target' | 'no_words' | 'active_batch';
  count: number;
  messageId?: number;
}

export interface WordReviewStatus {
  target: WordReviewConfig | null;
  totalChatWords: number;
  sentWordCount: number;
  remainingWordCount: number;
  lastSentAt: Date | null;
  activeBatch: {
    id: number;
    total: number;
    confirmed: number;
    awaitingCorrection: number;
  } | null;
}

export interface WordReviewActionInput {
  data: string;
  chatId: number;
  userId: number;
  username: string | null;
  displayName: string;
}

export interface WordReviewActionResult {
  status: 'handled' | 'ignored';
  message: string;
}

export interface WordReviewCorrectionReplyInput {
  chatId: number;
  userId: number;
  username: string | null;
  replyToMessageId: number;
  text: string;
}

export interface WordReviewCorrectionReplyResult {
  status: 'not_correction' | 'invalid_format' | 'stale' | 'applied';
  message?: string;
}

@Injectable()
export class WordReviewService {
  private readonly logger = new Logger(WordReviewService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly dictionary: DictionaryService,
    @InjectRepository(WordReviewConfig)
    private readonly configRepo: Repository<WordReviewConfig>,
    @InjectRepository(WordReviewHistory)
    private readonly historyRepo: Repository<WordReviewHistory>,
    @InjectRepository(WordReviewBatch)
    private readonly batchRepo: Repository<WordReviewBatch>,
    @InjectRepository(WordReviewItem)
    private readonly itemRepo: Repository<WordReviewItem>,
    @InjectRepository(WordReviewVote)
    private readonly voteRepo: Repository<WordReviewVote>,
    @InjectRepository(WordReviewCorrectionRequest)
    private readonly correctionRepo: Repository<WordReviewCorrectionRequest>,
    @InjectRepository(Word)
    private readonly wordRepo: Repository<Word>,
  ) {}

  async getTarget(): Promise<WordReviewConfig | null> {
    const configs = await this.configRepo.find({
      order: { setAt: 'DESC' },
      take: 1,
    });
    return configs[0] ?? null;
  }

  async setTarget(
    chatId: number,
    threadId: number | null,
    setBy: string,
  ): Promise<WordReviewConfig> {
    await this.configRepo.clear();
    const entity = this.configRepo.create({
      chatId,
      threadId,
      setBy,
      setAt: new Date(),
    });
    const saved = await this.configRepo.save(entity);
    this.logger.log(
      `Word review target set: chat=${chatId}, thread=${threadId ?? 'none'}, by=${setBy}`,
    );
    return saved;
  }

  async clearTarget(): Promise<void> {
    await this.configRepo.clear();
    this.logger.log('Word review target cleared');
  }

  async sendReviewBatch(): Promise<WordReviewSendResult> {
    const target = await this.getTarget();
    if (!target) {
      this.logger.log('Skipping word review — target chat is not configured');
      return { status: 'no_target', count: 0 };
    }

    const activeBatch = await this.batchRepo.findOne({
      where: { chatId: target.chatId, status: 'active' },
    });
    if (activeBatch) {
      this.logger.log(
        `Skipping word review — batch ${activeBatch.id} is still active`,
      );
      return { status: 'active_batch', count: 0 };
    }

    const words = await this.pickWordsForReview(DEFAULT_WORD_REVIEW_LIMIT);
    if (words.length === 0) {
      this.logger.log('Skipping word review — no unchecked chat words left');
      return { status: 'no_words', count: 0 };
    }

    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        chatId: target.chatId,
        threadId: target.threadId,
        messageId: null,
        status: 'active',
        requiredVotes: WORD_REVIEW_REQUIRED_VOTES,
        completedAt: null,
      }),
    );

    const items = await this.itemRepo.save(
      words.map((word, index) =>
        this.itemRepo.create({
          batchId: batch.id,
          wordId: word.id,
          position: index + 1,
          originalWord: word.word,
          originalTranslation: word.translation,
          proposedWord: word.word,
          proposedTranslation: word.translation,
          partOfSpeech: word.partOfSpeech,
          source: word.source,
          status: 'voting',
          revision: 1,
          confirmedAt: null,
        }),
      ),
    );

    let sent: Awaited<ReturnType<typeof this.bot.telegram.sendMessage>>;
    try {
      const text = this.buildReviewMessage(batch, items, new Map());
      sent = await this.bot.telegram.sendMessage(target.chatId, text, {
        message_thread_id: target.threadId ?? undefined,
        reply_markup: this.buildKeyboard(items),
      });
    } catch (error) {
      await this.itemRepo.delete({ batchId: batch.id });
      await this.batchRepo.delete({ id: batch.id });
      throw error;
    }

    batch.messageId =
      sent && 'message_id' in sent ? Number(sent.message_id) : null;
    await this.batchRepo.save(batch);
    try {
      await this.historyRepo.save(
        words.map((word) =>
          this.historyRepo.create({
            wordId: word.id,
            word: word.word,
            translation: word.translation,
            partOfSpeech: word.partOfSpeech,
            source: word.source,
            chatId: target.chatId,
            threadId: target.threadId,
            messageId: batch.messageId,
            sentAt: new Date(),
          }),
        ),
      );
    } catch (error) {
      this.logger.error(
        `Could not write legacy history for word review batch ${batch.id}`,
        error,
      );
    }

    this.logger.log(
      `Sent interactive word review batch ${batch.id}: ${words.length} words, chat=${target.chatId}`,
    );
    return {
      status: 'sent',
      count: words.length,
      messageId: batch.messageId ?? undefined,
    };
  }

  async handleAction(
    input: WordReviewActionInput,
  ): Promise<WordReviewActionResult> {
    const match = /^wr:(correct|fix):(\d+):(\d+)$/.exec(input.data);
    if (!match) return { status: 'ignored', message: '' };

    const action = match[1] as 'correct' | 'fix';
    const itemId = Number(match[2]);
    const revision = Number(match[3]);
    const item = await this.itemRepo.findOne({ where: { id: itemId } });
    if (!item) {
      return { status: 'handled', message: 'Это слово уже недоступно.' };
    }

    const batch = await this.batchRepo.findOne({
      where: { id: item.batchId },
    });
    if (!batch || batch.chatId !== input.chatId || batch.status !== 'active') {
      return { status: 'handled', message: 'Этот пакет уже завершён.' };
    }
    if (item.revision !== revision) {
      return {
        status: 'handled',
        message: 'Слово уже исправили. Нажмите кнопку под новым вариантом.',
      };
    }
    if (item.status === 'confirmed') {
      return { status: 'handled', message: 'Слово уже подтверждено.' };
    }

    if (action === 'fix') {
      return this.requestCorrection(batch, item, input);
    }

    if (item.status === 'awaiting_correction') {
      return {
        status: 'handled',
        message: 'Сначала ждём исправленный вариант этого слова.',
      };
    }
    if (item.status === 'confirming') {
      return { status: 'handled', message: 'Подтверждаем слово…' };
    }

    const existingVote = await this.voteRepo.findOne({
      where: { itemId: item.id, userId: input.userId, revision },
    });
    if (existingVote) {
      return { status: 'handled', message: 'Ваш голос уже учтён.' };
    }

    await this.voteRepo.save(
      this.voteRepo.create({
        itemId: item.id,
        userId: input.userId,
        username: input.username,
        revision,
      }),
    );
    const votes = await this.voteRepo.count({
      where: { itemId: item.id, revision },
    });

    if (votes < batch.requiredVotes) {
      await this.refreshBatchMessage(batch);
      return {
        status: 'handled',
        message: `Голос учтён: ${votes} из ${batch.requiredVotes}.`,
      };
    }

    const claimed = await this.itemRepo.update(
      { id: item.id, status: 'voting', revision },
      { status: 'confirming' },
    );
    if (!claimed.affected) {
      await this.refreshBatchMessage(batch);
      return { status: 'handled', message: 'Голос учтён.' };
    }

    try {
      await this.applyConfirmedCorrection(item);
      item.status = 'confirmed';
      item.confirmedAt = new Date();
      await this.itemRepo.save(item);
      await this.correctionRepo.update(
        { itemId: item.id, resolvedAt: IsNull() },
        { resolvedAt: new Date() },
      );
      await this.refreshBatchMessage(batch);
      await this.completeBatchIfReady(batch);
      return { status: 'handled', message: 'Слово подтверждено ✅' };
    } catch (error) {
      await this.itemRepo.update(
        { id: item.id, status: 'confirming' },
        { status: 'voting' },
      );
      await this.refreshBatchMessage(batch);
      this.logger.error(`Failed to confirm review item ${item.id}`, error);
      return {
        status: 'handled',
        message: 'Не получилось сохранить подтверждение. Попробуйте ещё раз.',
      };
    }
  }

  async handleCorrectionReply(
    input: WordReviewCorrectionReplyInput,
  ): Promise<WordReviewCorrectionReplyResult> {
    const request = await this.correctionRepo.findOne({
      where: {
        chatId: input.chatId,
        userId: input.userId,
        promptMessageId: input.replyToMessageId,
        resolvedAt: IsNull(),
      },
    });
    if (!request) return { status: 'not_correction' };

    const item = await this.itemRepo.findOne({
      where: { id: request.itemId },
    });
    if (!item || item.revision !== request.revision) {
      request.resolvedAt = new Date();
      await this.correctionRepo.save(request);
      return {
        status: 'stale',
        message: 'Это слово уже исправили. Используйте кнопки в пакете.',
      };
    }

    const batch = await this.batchRepo.findOne({
      where: { id: item.batchId },
    });
    if (!batch || batch.status !== 'active') {
      request.resolvedAt = new Date();
      await this.correctionRepo.save(request);
      return { status: 'stale', message: 'Этот пакет уже завершён.' };
    }

    const correction = this.parseCorrection(input.text);
    if (!correction) {
      return {
        status: 'invalid_format',
        message:
          'Напишите одним сообщением так:\nправильное слово — правильный перевод',
      };
    }

    item.proposedWord = correction.word;
    item.proposedTranslation = correction.translation;
    item.revision += 1;
    item.status = 'voting';
    item.confirmedAt = null;
    await this.itemRepo.save(item);
    await this.voteRepo.delete({ itemId: item.id });
    await this.correctionRepo.update(
      { itemId: item.id, resolvedAt: IsNull() },
      { resolvedAt: new Date() },
    );
    await this.refreshBatchMessage(batch);

    return {
      status: 'applied',
      message:
        `Исправление внесено в пакет:\n` +
        `${correction.word} — ${correction.translation}\n` +
        'Теперь слово нужно подтвердить заново.',
    };
  }

  async getStatus(): Promise<WordReviewStatus> {
    const target = await this.getTarget();
    const [totalChatWords, sentRaw, lastRows] = await Promise.all([
      this.wordRepo.count({ where: { source: 'chat' } }),
      this.historyRepo
        .createQueryBuilder('history')
        .select('COUNT(DISTINCT history.wordId)', 'count')
        .getRawOne<{ count: string }>(),
      this.historyRepo.find({ order: { sentAt: 'DESC' }, take: 1 }),
    ]);
    const sentWordCount = Number(sentRaw?.count ?? 0);

    let activeBatch: WordReviewStatus['activeBatch'] = null;
    if (target) {
      const batch = await this.batchRepo.findOne({
        where: { chatId: target.chatId, status: 'active' },
      });
      if (batch) {
        const [total, confirmed, awaitingCorrection] = await Promise.all([
          this.itemRepo.count({ where: { batchId: batch.id } }),
          this.itemRepo.count({
            where: { batchId: batch.id, status: 'confirmed' },
          }),
          this.itemRepo.count({
            where: { batchId: batch.id, status: 'awaiting_correction' },
          }),
        ]);
        activeBatch = { id: batch.id, total, confirmed, awaitingCorrection };
      }
    }

    return {
      target,
      totalChatWords,
      sentWordCount,
      remainingWordCount: Math.max(totalChatWords - sentWordCount, 0),
      lastSentAt: lastRows[0]?.sentAt ?? null,
      activeBatch,
    };
  }

  private async requestCorrection(
    batch: WordReviewBatch,
    item: WordReviewItem,
    input: WordReviewActionInput,
  ): Promise<WordReviewActionResult> {
    const existing = await this.correctionRepo.findOne({
      where: {
        itemId: item.id,
        userId: input.userId,
        revision: item.revision,
        resolvedAt: IsNull(),
      },
    });
    if (existing) {
      return {
        status: 'handled',
        message: 'Ответьте на сообщение бота с просьбой об исправлении.',
      };
    }

    if (item.status !== 'awaiting_correction') {
      item.status = 'awaiting_correction';
      await this.itemRepo.save(item);
    }

    try {
      const prompt = await this.bot.telegram.sendMessage(
        batch.chatId,
        `${input.displayName}, как правильно записать слово №${item.position}?\n\n` +
          `Сейчас: ${item.proposedWord} — ${item.proposedTranslation}\n\n` +
          'Ответьте на это сообщение так:\n' +
          'правильное слово — правильный перевод\n\n' +
          'Если нажали случайно, отправьте текущий вариант без изменений.',
        {
          message_thread_id: batch.threadId ?? undefined,
          reply_parameters: batch.messageId
            ? { message_id: batch.messageId }
            : undefined,
        },
      );
      const promptMessageId =
        prompt && 'message_id' in prompt ? Number(prompt.message_id) : null;
      if (!promptMessageId) throw new Error('Telegram returned no message id');

      await this.correctionRepo.save(
        this.correctionRepo.create({
          itemId: item.id,
          chatId: batch.chatId,
          userId: input.userId,
          username: input.username,
          promptMessageId,
          revision: item.revision,
          resolvedAt: null,
        }),
      );
      await this.refreshBatchMessage(batch);
      return {
        status: 'handled',
        message: 'Напишите правильный вариант в ответ на сообщение бота.',
      };
    } catch (error) {
      item.status = 'voting';
      await this.itemRepo.save(item);
      await this.refreshBatchMessage(batch);
      this.logger.error(
        `Could not request correction for review item ${item.id}`,
        error,
      );
      return {
        status: 'handled',
        message: 'Не получилось запросить исправление. Попробуйте ещё раз.',
      };
    }
  }

  private async applyConfirmedCorrection(item: WordReviewItem): Promise<void> {
    const changed =
      item.proposedWord.trim().toLowerCase() !==
        item.originalWord.trim().toLowerCase() ||
      item.proposedTranslation.trim() !== item.originalTranslation.trim();
    if (!changed) return;

    const result = await this.dictionary.updateWord({
      oldWord: item.originalWord,
      newWord: item.proposedWord,
      translation: item.proposedTranslation,
      updatedBy: 'word-review',
    });
    if (result.status !== 'updated' && result.status !== 'merged') {
      throw new Error(`Dictionary update returned ${result.status}`);
    }
    if (result.word) {
      item.wordId = result.word.id;
      item.proposedWord = result.word.word;
      item.proposedTranslation = result.word.translation;
    }
  }

  private async completeBatchIfReady(batch: WordReviewBatch): Promise<void> {
    const unresolved = await this.itemRepo.count({
      where: { batchId: batch.id, status: Not('confirmed') },
    });
    if (unresolved > 0) return;

    const completedAt = new Date();
    const claimed = await this.batchRepo.update(
      { id: batch.id, status: 'active' },
      { status: 'completed', completedAt },
    );
    if (!claimed.affected) return;

    batch.status = 'completed';
    batch.completedAt = completedAt;
    await this.refreshBatchMessage(batch);

    const next = await this.sendReviewBatch();
    if (next.status === 'no_words') {
      await this.bot.telegram.sendMessage(
        batch.chatId,
        '🎉 Все доступные слова прошли первый круг проверки.',
        { message_thread_id: batch.threadId ?? undefined },
      );
    }
  }

  private async refreshBatchMessage(batch: WordReviewBatch): Promise<void> {
    if (!batch.messageId) return;
    const items = await this.itemRepo.find({
      where: { batchId: batch.id },
      order: { position: 'ASC' },
    });
    const voteCounts = new Map<number, number>();
    await Promise.all(
      items.map(async (item) => {
        const count = await this.voteRepo.count({
          where: { itemId: item.id, revision: item.revision },
        });
        voteCounts.set(item.id, count);
      }),
    );

    try {
      await this.bot.telegram.editMessageText(
        batch.chatId,
        batch.messageId,
        undefined,
        this.buildReviewMessage(batch, items, voteCounts),
        { reply_markup: this.buildKeyboard(items) },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('message is not modified')) {
        this.logger.warn(
          `Could not refresh word review batch ${batch.id}: ${message}`,
        );
      }
    }
  }

  private buildReviewMessage(
    batch: WordReviewBatch,
    items: WordReviewItem[],
    voteCounts: Map<number, number>,
  ): string {
    const confirmed = items.filter(
      (item) => item.status === 'confirmed',
    ).length;
    const lines = [
      batch.status === 'completed'
        ? `✅ Пакет проверен: ${confirmed} из ${items.length}`
        : `📖 Проверка словаря: ${confirmed} из ${items.length}`,
      '',
      `Для подтверждения нужны ${batch.requiredVotes} голоса «Верно».`,
      'Если есть ошибка, нажмите «Исправить» и ответьте боту.',
      'Следующий пакет придёт только после проверки всех слов.',
      '',
    ];

    for (const item of items) {
      const votes = voteCounts.get(item.id) ?? 0;
      const marker =
        item.status === 'confirmed'
          ? '✅'
          : item.status === 'awaiting_correction'
            ? '✏️'
            : `⏳ ${votes}/${batch.requiredVotes}`;
      const pos = item.partOfSpeech ? ` (${item.partOfSpeech})` : '';
      lines.push(
        `${item.position}. ${marker} ${item.proposedWord} — ${this.truncate(item.proposedTranslation, 160)}${pos}`,
      );
    }

    return lines.join('\n');
  }

  private buildKeyboard(items: WordReviewItem[]) {
    return {
      inline_keyboard: items
        .filter((item) => item.status !== 'confirmed')
        .map((item) => [
          {
            text: `${item.position} ✅ Верно`,
            callback_data: `wr:correct:${item.id}:${item.revision}`,
          },
          {
            text: `${item.position} ✏️ Исправить`,
            callback_data: `wr:fix:${item.id}:${item.revision}`,
          },
        ]),
    };
  }

  private parseCorrection(
    text: string,
  ): { word: string; translation: string } | null {
    const match = /^(.+?)(?:\s+[–-]\s+|\s*—\s*)(.+)$/s.exec(text.trim());
    if (!match) return null;
    const word = match[1].trim();
    const translation = match[2].trim();
    if (!word || !translation || word.length > 255) return null;
    return { word, translation };
  }

  private async pickWordsForReview(limit: number): Promise<Word[]> {
    const [sentRows, reviewItems] = await Promise.all([
      this.historyRepo.find({ select: { wordId: true } }),
      this.itemRepo.find({ select: { wordId: true } }),
    ]);
    const sentIds = [
      ...new Set([
        ...sentRows.map((row) => row.wordId),
        ...reviewItems.map((item) => item.wordId),
      ]),
    ];

    const query = this.wordRepo
      .createQueryBuilder('word')
      .where('word.source = :source', { source: 'chat' })
      .andWhere("word.translation <> ''")
      .orderBy('word.createdAt', 'ASC')
      .addOrderBy('word.id', 'ASC')
      .limit(limit);
    if (sentIds.length > 0) {
      query.andWhere('word.id NOT IN (:...sentIds)', { sentIds });
    }
    return query.getMany();
  }

  private truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }
}
