import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { In, IsNull, Repository } from 'typeorm';
import { Word } from '../dictionary/entities/word.entity';
import { WordReviewBatch } from './entities/word-review-batch.entity';
import { WordReviewConfig } from './entities/word-review-config.entity';
import { WordReviewHistory } from './entities/word-review-history.entity';
import { WordReviewItem } from './entities/word-review-item.entity';
import {
  WordReviewDecision,
  WordReviewDecisionChange,
} from './entities/word-review-decision.entity';
import {
  normalizeReviewWord,
  ReviewDecisionRequest,
  ReviewWordReference,
  WordReviewDecisionError,
} from './word-review-decision';

import { compareTsintskaroWords } from '../dictionary/tsintskaro-alphabet';
import {
  formatReviewDate,
  nextReviewDate,
  reviewCalendarDate,
} from './word-review-schedule';

export const DEFAULT_WORD_REVIEW_LIMIT = 10;
export const MAX_WORD_REVIEW_LIMIT = 100;

export interface WordReviewSendResult {
  status: 'sent' | 'no_target' | 'no_words' | 'paused' | 'not_due';
  count: number;
  messageId?: number;
}

export interface WordReviewStatus {
  target: WordReviewConfig | null;
  totalWords: number;
  sentWordCount: number;
  remainingWordCount: number;
  waitingNextPassCount: number;
  lastSentAt: Date | null;
  publishedBatchCount: number;
  sendingBatchId: number | null;
  confirmedWordCount: number;
  disputedWordCount: number;
  openWordCount: number;
  completedBatchCount: number;
}

export interface ReviewDecisionResult {
  batchId: number;
  completed: boolean;
  alreadyApplied: boolean;
  confirmed: { position: number; word: string }[];
  disputed: { position: number; word: string }[];
  pending: { position: number; word: string }[];
}

@Injectable()
export class WordReviewService {
  private readonly logger = new Logger(WordReviewService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    @InjectRepository(WordReviewConfig)
    private readonly configRepo: Repository<WordReviewConfig>,
    @InjectRepository(WordReviewHistory)
    private readonly historyRepo: Repository<WordReviewHistory>,
    @InjectRepository(WordReviewBatch)
    private readonly batchRepo: Repository<WordReviewBatch>,
    @InjectRepository(WordReviewItem)
    private readonly itemRepo: Repository<WordReviewItem>,
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

  private async withScheduleLock<T>(action: () => Promise<T>): Promise<T> {
    const runner = this.configRepo.manager.connection.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(
        "SELECT pg_advisory_lock(hashtext('tsintskaro.word-review'))",
      );
      try {
        return await action();
      } finally {
        await runner.query(
          "SELECT pg_advisory_unlock(hashtext('tsintskaro.word-review'))",
        );
      }
    } finally {
      await runner.release();
    }
  }

  async setTarget(
    chatId: number,
    threadId: number | null,
    setBy: string,
  ): Promise<WordReviewConfig> {
    return this.withScheduleLock(async () => {
      const previous = await this.getTarget();
      if (
        previous &&
        (previous.chatId !== chatId || previous.threadId !== threadId)
      ) {
        throw new Error(
          'Проверка уже настроена в другой теме. Управляйте ею из той темы.',
        );
      }
      const now = new Date();
      const target =
        previous ??
        this.configRepo.create({
          chatId,
          threadId,
          batchSize: DEFAULT_WORD_REVIEW_LIMIT,
          nextRunAt: now,
        });
      target.enabled = true;
      target.setBy = setBy;
      target.setAt = now;
      target.nextRunAt ??= now;
      target.dictionaryCutoffAt ??= now;
      return this.configRepo.save(target);
    });
  }

  async clearTarget(chatId: number, threadId: number | null): Promise<void> {
    await this.withScheduleLock(async () => {
      const target = await this.getTarget();
      if (!target) return;
      this.assertTarget(target, chatId, threadId);
      await this.configRepo.update({ id: target.id }, { enabled: false });
    });
  }

  async setBatchSize(
    chatId: number,
    threadId: number | null,
    size: number,
    setBy: string,
  ): Promise<WordReviewConfig> {
    if (!Number.isInteger(size) || size < 1 || size > MAX_WORD_REVIEW_LIMIT) {
      throw new Error(
        `Количество слов должно быть целым числом от 1 до ${MAX_WORD_REVIEW_LIMIT}.`,
      );
    }
    return this.withScheduleLock(async () => {
      const existing = await this.getTarget();
      if (existing) this.assertTarget(existing, chatId, threadId);
      const target =
        existing ??
        this.configRepo.create({
          chatId,
          threadId,
          enabled: false,
          nextRunAt: null,
        });
      target.batchSize = size;
      target.setBy = setBy;
      target.setAt = new Date();
      return this.configRepo.save(target);
    });
  }

  private assertTarget(
    target: WordReviewConfig,
    chatId: number,
    threadId: number | null,
  ) {
    if (target.chatId !== chatId || target.threadId !== threadId) {
      throw new Error(
        'Вызовите команду в теме, где настроена проверка словаря.',
      );
    }
  }

  async sendReviewBatch(
    options: {
      scheduled?: boolean;
      extra?: boolean;
      chatId?: number;
      threadId?: number | null;
    } = {},
  ): Promise<WordReviewSendResult> {
    return this.withScheduleLock(async () => {
      const target = await this.getTarget();
      if (!target) return { status: 'no_target', count: 0 };
      if (options.chatId != null)
        this.assertTarget(target, options.chatId, options.threadId ?? null);
      if (!target.enabled && !options.extra)
        return { status: 'paused', count: 0 };
      if (!target.dictionaryCutoffAt) return { status: 'no_target', count: 0 };
      const now = new Date();
      const pendingBatch = await this.batchRepo.findOne({
        where: { chatId: target.chatId, status: 'sending' },
        order: { id: 'ASC' },
      });
      if (
        options.scheduled &&
        pendingBatch?.status !== 'sending' &&
        target.nextRunAt &&
        new Date(target.nextRunAt) > now
      ) {
        return { status: 'not_due', count: 0 };
      }

      let batch = pendingBatch;
      let items: WordReviewItem[];
      if (batch) {
        items = await this.itemRepo.find({
          where: { batchId: batch.id },
          order: { position: 'ASC' },
        });
      } else {
        let passCutoff = target.dictionaryCutoffAt;
        let words = await this.pickWordsForReview(
          target.batchSize ?? DEFAULT_WORD_REVIEW_LIMIT,
          passCutoff,
        );
        if (words.length === 0 && new Date(passCutoff) < now) {
          // Finish the current snapshot before admitting later additions. The
          // delivery ledger keeps both reviewed and still-discussed words out.
          passCutoff = now;
          words = await this.pickWordsForReview(
            target.batchSize ?? DEFAULT_WORD_REVIEW_LIMIT,
            passCutoff,
          );
        }
        if (words.length === 0) {
          if (!options.extra) {
            await this.configRepo.update(
              { id: target.id },
              {
                nextRunAt:
                  target.nextRunAt && new Date(target.nextRunAt) > now
                    ? target.nextRunAt
                    : nextReviewDate(target.nextRunAt ?? now, now),
              },
            );
          }
          return { status: 'no_words', count: 0 };
        }
        // Persist the batch and all its items together before publishing any page.
        const saved = await this.batchRepo.manager.transaction(
          async (manager) => {
            const batches = manager.getRepository(WordReviewBatch);
            const reviewItems = manager.getRepository(WordReviewItem);
            // Save a new pass boundary with its first batch so interrupted
            // delivery resumes the same snapshot after a restart.
            if (passCutoff !== target.dictionaryCutoffAt) {
              await manager
                .getRepository(WordReviewConfig)
                .update({ id: target.id }, { dictionaryCutoffAt: passCutoff });
            }
            const newBatch = await batches.save(
              batches.create({
                chatId: target.chatId,
                threadId: target.threadId,
                messageId: null,
                messageIds: [],
                status: 'sending',
                reviewFlow: 'dictionary',
                requiredVotes: 0,
                advanceSchedule: !options.extra,
                discussionEndsAt: this.discussionEnd(now),
                completedAt: null,
              }),
            );
            const newItems = await reviewItems.save(
              words.map((word, index) =>
                reviewItems.create({
                  batchId: newBatch.id,
                  wordId: word.id,
                  position: index + 1,
                  originalWord: word.word,
                  originalTranslation: word.translation,
                  proposedWord: word.word,
                  proposedTranslation: word.translation,
                  partOfSpeech: word.partOfSpeech,
                  source: word.source,
                  status: 'discussion',
                  revision: 1,
                  confirmedAt: null,
                }),
              ),
            );
            return { batch: newBatch, items: newItems };
          },
        );
        batch = saved.batch;
        items = saved.items;
      }

      batch.discussionEndsAt ??= this.discussionEnd(now);
      const pages = this.buildReviewPages(batch, items);
      batch.messageIds ??= [];
      for (let index = batch.messageIds.length; index < pages.length; index++) {
        const page = pages[index];
        const sent = await this.bot.telegram.sendMessage(
          target.chatId,
          page.text,
          {
            message_thread_id: target.threadId ?? undefined,
            entities: page.entities,
          },
        );
        batch.messageIds.push(sent.message_id);
        batch.messageId ??= sent.message_id;
        await this.batchRepo.save(batch);
      }
      batch.status = 'published';
      await this.batchRepo.manager.transaction(async (manager) => {
        await manager.getRepository(WordReviewBatch).save(batch);
        if (batch.advanceSchedule) {
          await manager.getRepository(WordReviewConfig).update(
            { id: target.id },
            {
              nextRunAt:
                target.nextRunAt && new Date(target.nextRunAt) > now
                  ? target.nextRunAt
                  : nextReviewDate(target.nextRunAt ?? now, now),
            },
          );
        }
      });
      // Items are the authoritative delivery ledger. History is retained for old reports.
      try {
        await this.historyRepo.save(
          items.map((item) =>
            this.historyRepo.create({
              wordId: item.wordId,
              word: item.originalWord,
              translation: item.originalTranslation,
              partOfSpeech: item.partOfSpeech,
              source: item.source,
              chatId: target.chatId,
              threadId: target.threadId,
              messageId: batch.messageId,
              sentAt: now,
            }),
          ),
        );
      } catch (error) {
        this.logger.error(
          `Could not write legacy history for word review batch ${batch.id}`,
          error,
        );
      }
      return {
        status: 'sent',
        count: items.length,
        messageId: batch.messageId ?? undefined,
      };
    });
  }

  async isReviewMessage(chatId: number, messageId: number): Promise<boolean> {
    return this.batchRepo
      .createQueryBuilder('batch')
      .where('batch.chatId = :chatId', { chatId })
      .andWhere(
        '(batch.messageId = :messageId OR batch.messageIds @> CAST(:messageIds AS jsonb))',
        {
          messageId,
          messageIds: JSON.stringify([messageId]),
        },
      )
      .getExists();
  }

  async recordDecision(input: {
    request: ReviewDecisionRequest;
    chatId: number;
    threadId: number | null;
    replyToMessageId?: number;
    userId: number;
    username: string | null;
    messageId: number;
  }): Promise<ReviewDecisionResult> {
    if (
      !Number.isSafeInteger(input.userId) ||
      input.userId <= 0 ||
      !Number.isSafeInteger(input.messageId) ||
      input.messageId <= 0
    ) {
      throw new WordReviewDecisionError(
        'Не удалось определить автора итогов. Отправьте сообщение от своего аккаунта.',
      );
    }
    return this.withScheduleLock(async () => {
      const target = await this.getTarget();
      if (
        !target ||
        target.chatId !== input.chatId ||
        target.threadId !== input.threadId
      )
        throw new WordReviewDecisionError(
          'Подведите итоги в теме, где бот публикует партии слов.',
        );

      return this.batchRepo.manager.transaction(async (manager) => {
        const batches = manager.getRepository(WordReviewBatch);
        const reviewItems = manager.getRepository(WordReviewItem);
        const decisions = manager.getRepository(WordReviewDecision);
        const previous = await decisions.findOne({
          where: { chatId: input.chatId, messageId: input.messageId },
        });
        const available = await batches.find({
          where: {
            chatId: input.chatId,
            threadId: input.threadId ?? IsNull(),
            reviewFlow: 'dictionary',
          },
        });
        const replyBatch =
          input.replyToMessageId == null
            ? undefined
            : available.find(
                (batch) =>
                  batch.messageId === input.replyToMessageId ||
                  batch.messageIds?.includes(input.replyToMessageId),
              );
        let batch = previous
          ? available.find((entry) => entry.id === previous.batchId)
          : input.request.batchId != null
            ? available.find((entry) => entry.id === input.request.batchId)
            : replyBatch;
        if (
          !previous &&
          replyBatch &&
          input.request.batchId != null &&
          replyBatch.id !== input.request.batchId
        )
          throw new WordReviewDecisionError(
            'Номер партии в тексте не совпадает с партией в ответе. Укажите одну партию.',
          );

        // A word name can identify a batch only when every requested word matches
        // exactly one item in exactly one published batch in this topic.
        if (
          !batch &&
          input.request.batchId == null &&
          !replyBatch &&
          !previous &&
          ['confirm', 'dispute'].includes(input.request.mode) &&
          input.request.words.length &&
          input.request.words.every((word) => 'word' in word)
        ) {
          const published = available.filter((entry) =>
            ['published', 'completed'].includes(entry.status),
          );
          const candidates = published.length
            ? await reviewItems.find({
                where: { batchId: In(published.map((entry) => entry.id)) },
              })
            : [];
          const matches = published.filter((entry) =>
            input.request.words.every(
              (word) =>
                candidates.filter(
                  (item) =>
                    item.batchId === entry.id &&
                    this.matchesReviewWord(item, word),
                ).length === 1,
            ),
          );
          if (matches.length === 1) batch = matches[0];
        }
        if (!batch)
          throw new WordReviewDecisionError(
            'Не удалось однозначно определить партию. Укажите её номер и номера слов или ответьте на список бота.',
          );
        if (!['published', 'completed'].includes(batch.status))
          throw new WordReviewDecisionError(
            'Эта партия ещё не опубликована полностью. Подведите итоги после завершения отправки.',
          );
        const items = await reviewItems.find({
          where: { batchId: batch.id },
          order: { position: 'ASC' },
        });
        if (!items.length)
          throw new WordReviewDecisionError(
            'В этой партии нет слов для подведения итогов.',
          );
        if (previous) return this.decisionResult(batch, items, true);

        const selected = new Set<number>();
        for (const reference of input.request.words) {
          const matches = items.filter((item) =>
            this.matchesReviewWord(item, reference),
          );
          if (matches.length !== 1) {
            const label =
              'position' in reference
                ? `№${reference.position}`
                : `«${reference.word}»`;
            throw new WordReviewDecisionError(
              `Слово ${label} не найдено однозначно в партии №${batch.id}. Уточните список; итог не сохранён.`,
            );
          }
          selected.add(matches[0].id);
        }
        if (input.request.mode !== 'all' && !selected.size)
          throw new WordReviewDecisionError(
            'Перечислите слова, по которым подводите итог.',
          );

        const now = new Date();
        const changes: WordReviewDecisionChange[] = [];
        const changed: WordReviewItem[] = [];
        for (const item of items) {
          let status: 'confirmed' | 'disputed';
          if (input.request.mode === 'all') status = 'confirmed';
          else if (input.request.mode === 'all_except')
            status = selected.has(item.id) ? 'disputed' : 'confirmed';
          else if (selected.has(item.id))
            status =
              input.request.mode === 'confirm' ? 'confirmed' : 'disputed';
          else continue;
          if (item.status === status) continue;
          changes.push({
            itemId: item.id,
            wordId: item.wordId,
            word: item.originalWord,
            previousStatus: item.status,
            status,
          });
          item.status = status;
          item.confirmedAt = status === 'confirmed' ? now : null;
          changed.push(item);
        }
        if (changed.length) await reviewItems.save(changed);
        const completed = items.every((item) => item.status === 'confirmed');
        batch.status = completed ? 'completed' : 'published';
        batch.completedAt = completed ? (batch.completedAt ?? now) : null;
        await batches.save(batch);
        await decisions.save(
          decisions.create({
            batchId: batch.id,
            chatId: input.chatId,
            threadId: input.threadId,
            messageId: input.messageId,
            userId: input.userId,
            username: input.username,
            changes,
          }),
        );
        return this.decisionResult(batch, items, false);
      });
    });
  }

  private matchesReviewWord(
    item: WordReviewItem,
    reference: ReviewWordReference,
  ): boolean {
    return 'position' in reference
      ? item.position === reference.position
      : normalizeReviewWord(item.originalWord) ===
          normalizeReviewWord(reference.word);
  }

  private decisionResult(
    batch: WordReviewBatch,
    items: WordReviewItem[],
    alreadyApplied: boolean,
  ): ReviewDecisionResult {
    const list = (predicate: (item: WordReviewItem) => boolean) =>
      items
        .filter(predicate)
        .map((item) => ({ position: item.position, word: item.originalWord }));
    return {
      batchId: batch.id,
      completed: batch.status === 'completed',
      alreadyApplied,
      confirmed: list((item) => item.status === 'confirmed'),
      disputed: list((item) => item.status === 'disputed'),
      pending: list(
        (item) => item.status !== 'confirmed' && item.status !== 'disputed',
      ),
    };
  }

  async getStatus(): Promise<WordReviewStatus> {
    const target = await this.getTarget();
    const [allWords, allCandidates, lastRows] = await Promise.all([
      this.reviewWordQuery(target?.dictionaryCutoffAt).getMany(),
      this.pickWordsForReview(Number.MAX_SAFE_INTEGER, new Date()),
      this.batchRepo.find({
        where: { status: In(['active', 'published', 'completed']) },
        order: { createdAt: 'DESC' },
        take: 1,
      }),
    ]);
    const candidates = target?.dictionaryCutoffAt
      ? allCandidates.filter(
          (word) =>
            new Date(word.createdAt) <= new Date(target.dictionaryCutoffAt),
        )
      : allCandidates;
    const totalWords = allWords.length;
    const remainingWordCount = candidates.length;
    const sentWordCount = totalWords - remainingWordCount;

    const [publishedBatchCount, sendingBatch] = target
      ? await Promise.all([
          this.batchRepo.count({
            where: {
              chatId: target.chatId,
              status: In(['active', 'published', 'completed']),
            },
          }),
          this.batchRepo.findOne({
            where: { chatId: target.chatId, status: 'sending' },
          }),
        ])
      : [0, null];

    const reviewBatches = target
      ? await this.batchRepo.find({
          where: {
            chatId: target.chatId,
            threadId: target.threadId ?? IsNull(),
            reviewFlow: 'dictionary',
            status: In(['published', 'completed']),
          },
        })
      : [];
    const reviewItems = reviewBatches.length
      ? await this.itemRepo.find({
          where: { batchId: In(reviewBatches.map((batch) => batch.id)) },
        })
      : [];

    return {
      target,
      totalWords,
      sentWordCount,
      remainingWordCount,
      waitingNextPassCount: allCandidates.length - candidates.length,
      lastSentAt: lastRows[0]?.createdAt ?? null,
      publishedBatchCount,
      sendingBatchId: sendingBatch?.id ?? null,
      confirmedWordCount: reviewItems.filter(
        (item) => item.status === 'confirmed',
      ).length,
      disputedWordCount: reviewItems.filter(
        (item) => item.status === 'disputed',
      ).length,
      openWordCount: reviewItems.filter((item) => item.status !== 'confirmed')
        .length,
      completedBatchCount: reviewBatches.filter(
        (batch) => batch.status === 'completed',
      ).length,
    };
  }

  private discussionEnd(sentAt: Date): Date {
    const end = new Date(`${reviewCalendarDate(sentAt)}T22:00:00+04:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    return end;
  }

  private buildReviewPages(batch: WordReviewBatch, items: WordReviewItem[]) {
    const flowLabel =
      batch.reviewFlow === 'learning' ? '💬 Обучение' : '📚 Словарь';
    const heading = [
      `${flowLabel} · партия №${batch.id} · ${items.length} слов`,
      `Обсуждение до ${formatReviewDate(new Date(batch.discussionEndsAt))}.`,
      '',
    ].join('\n');
    type CodeEntity = { type: 'code'; offset: number; length: number };
    const pages: { text: string; entities: CodeEntity[] }[] = [];
    let entities: CodeEntity[] = [];
    let lines: string[] = [];
    let length = heading.length;
    // Preserve full words and translations. Split long entries across messages
    // instead of hiding meanings that participants need to review.
    for (const item of items) {
      const pos = item.partOfSpeech ? ` (${item.partOfSpeech})` : '';
      const prefix = `${item.position}. `;
      const line = `${prefix}${item.originalWord} — ${item.originalTranslation}${pos}`;
      if (
        lines.length &&
        (lines.length >= 10 ||
          length + prefix.length + item.originalWord.length + 1 > 3800 ||
          (line.length <= 3800 - heading.length - 1 &&
            length + line.length + 1 > 3800))
      ) {
        pages.push({ text: heading + '\n' + lines.join('\n'), entities });
        lines = [];
        entities = [];
        length = heading.length;
      }
      for (let offset = 0; offset < line.length; ) {
        const room = 3800 - length - 1;
        if (room <= 0) {
          pages.push({ text: heading + '\n' + lines.join('\n'), entities });
          lines = [];
          entities = [];
          length = heading.length;
          continue;
        }
        let end = Math.min(offset + room, line.length);
        // Avoid cutting a UTF-16 surrogate pair in half.
        if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1])) end--;
        const part = line.slice(offset, end);
        if (offset === 0 && item.originalWord.length) {
          // Telegram entity offsets use UTF-16, matching JavaScript string lengths.
          entities.push({
            type: 'code',
            offset: length + 1 + prefix.length,
            length: item.originalWord.length,
          });
        }
        lines.push(part);
        length += part.length + 1;
        offset = end;
      }
    }
    if (lines.length)
      pages.push({ text: heading + '\n' + lines.join('\n'), entities });
    return pages;
  }

  private reviewWordQuery(cutoff?: Date | null) {
    const query = this.wordRepo.createQueryBuilder('word');
    if (cutoff) query.where('word.createdAt <= :cutoff', { cutoff });
    return query;
  }

  private async pickWordsForReview(
    limit: number,
    cutoff?: Date | null,
  ): Promise<Word[]> {
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

    const query = this.reviewWordQuery(cutoff);
    if (sentIds.length > 0) {
      query.andWhere('word.id NOT IN (:...sentIds)', { sentIds });
    }
    const words = await query.getMany();
    return words
      .sort((a, b) => compareTsintskaroWords(a.word, b.word) || a.id - b.id)
      .slice(0, limit);
  }
}
