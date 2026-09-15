import { WordReviewService } from './word-review.service';
import { WordReviewBatch } from './entities/word-review-batch.entity';
import { WordReviewConfig } from './entities/word-review-config.entity';
import { WordReviewItem } from './entities/word-review-item.entity';
import { WordReviewDecision } from './entities/word-review-decision.entity';
import { ReviewDecisionRequest } from './word-review-decision';

describe('WordReviewService discussion batches', () => {
  const makeRepo = () => ({
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => value),
    findOne: jest.fn(),
    find: jest.fn(async (_options?: any) => {
      void _options;
      return [];
    }),
    count: jest.fn(async () => 0),
    update: jest.fn(async (_criteria?: any, _changes?: any) => {
      void _criteria;
      void _changes;
      return { affected: 1 };
    }),
    delete: jest.fn(async () => ({ affected: 1 })),
    clear: jest.fn(),
    createQueryBuilder: jest.fn(),
    manager: {} as any,
  });

  const makeService = () => {
    const bot = {
      telegram: {
        sendMessage: jest.fn(async () => ({ message_id: 777 })),
        editMessageText: jest.fn(async () => ({})),
      },
    };
    const configRepo = makeRepo();
    const historyRepo = makeRepo();
    const batchRepo = makeRepo();
    const itemRepo = makeRepo();
    const decisionRepo = makeRepo();
    const wordRepo = makeRepo();
    let lockTail = Promise.resolve();
    const createQueryRunner = () => {
      let unlock: () => void;
      return {
        connect: jest.fn(),
        release: jest.fn(),
        query: jest.fn(async (sql: string) => {
          if (sql.includes('pg_advisory_lock(')) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => {
              unlock = resolve;
            });
            await previous;
          } else if (sql.includes('pg_advisory_unlock(')) unlock();
        }),
      };
    };
    const manager = {
      getRepository: (entity: unknown) =>
        entity === WordReviewBatch
          ? batchRepo
          : entity === WordReviewConfig
            ? configRepo
            : entity === WordReviewItem
              ? itemRepo
              : entity === WordReviewDecision
                ? decisionRepo
                : null,
    };
    configRepo.manager = { connection: { createQueryRunner } };
    batchRepo.manager = { transaction: async (action: any) => action(manager) };
    const service = new WordReviewService(
      bot as any,
      configRepo as any,
      historyRepo as any,
      batchRepo as any,
      itemRepo as any,
      wordRepo as any,
    );
    return {
      service,
      bot,
      configRepo,
      historyRepo,
      batchRepo,
      itemRepo,
      wordRepo,
      decisionRepo,
    };
  };

  const makeDelivery = (size = 10) => {
    const fixture = makeService();
    const {
      configRepo,
      batchRepo,
      itemRepo,
      wordRepo,
      bot,
      historyRepo,
      decisionRepo,
    } = fixture;
    let target: any = {
      id: 1,
      chatId: -100,
      threadId: 44,
      enabled: true,
      batchSize: size,
      nextRunAt: new Date('2026-09-13T06:00:00Z'),
      dictionaryCutoffAt: new Date('2026-09-13T06:00:00Z'),
    };
    let batches: any[] = [];
    const items: any[] = [];
    const history: any[] = [];
    const decisions: any[] = [];
    const matches = (entry: any, where: any) =>
      !where ||
      Object.entries(where).every(([key, value]: [string, any]) =>
        value?.type === 'in'
          ? value.value.includes(entry[key])
          : value?.type === 'isNull'
            ? entry[key] == null
            : entry[key] === value,
      );
    const words = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      word: `а${String(index).padStart(3, '0')}`,
      translation: 'перевод',
      partOfSpeech: null,
      source: index % 2 ? 'chat' : 'etalon',
      createdAt: new Date('2026-09-12T00:00:00Z'),
    }));
    configRepo.find.mockImplementation(async () =>
      target ? [structuredClone(target)] : [],
    );
    configRepo.save.mockImplementation(async (value) => {
      target = { ...value, id: 1 };
      return structuredClone(target);
    });
    configRepo.update.mockImplementation(async (_criteria, changes) => {
      Object.assign(target, changes);
      return { affected: 1 };
    });
    batchRepo.findOne.mockImplementation(async (options) =>
      structuredClone(
        batches.find((entry) => matches(entry, options.where)) ?? null,
      ),
    );
    batchRepo.find.mockImplementation(async (options) =>
      structuredClone(
        batches.filter((entry) => matches(entry, options?.where)),
      ),
    );
    decisionRepo.findOne.mockImplementation(async (options) =>
      structuredClone(
        decisions.find((entry) => matches(entry, options?.where)) ?? null,
      ),
    );
    decisionRepo.save.mockImplementation(async (value) => {
      decisions.push(structuredClone(value));
      return value;
    });
    batchRepo.save.mockImplementation(async (value) => {
      const saved = { ...value, id: value.id ?? batches.length + 1 };
      batches = [
        ...batches.filter((entry) => entry.id !== saved.id),
        structuredClone(saved),
      ];
      return structuredClone(saved);
    });
    itemRepo.save.mockImplementation(async (value) => {
      const saved = value.map((entry, index) => ({
        ...entry,
        id: entry.id ?? items.length + index + 1,
      }));
      for (const entry of saved) {
        const index = items.findIndex((item) => item.id === entry.id);
        if (index === -1) items.push(structuredClone(entry));
        else items[index] = structuredClone(entry);
      }
      return saved;
    });
    itemRepo.find.mockImplementation(async (options) =>
      structuredClone(
        options?.where
          ? items.filter((entry) => matches(entry, options.where))
          : items,
      ),
    );
    historyRepo.save.mockImplementation(async (value) => {
      history.push(...structuredClone(value));
      return value;
    });
    historyRepo.find.mockImplementation(async () => structuredClone(history));
    wordRepo.createQueryBuilder.mockImplementation(() => {
      let excluded: number[] = [];
      let cutoff: Date | undefined;
      const query = {
        where: jest.fn((_sql, values) => {
          cutoff = values?.cutoff;
          return query;
        }),
        andWhere: jest.fn((_sql, values) => {
          excluded = values?.sentIds ?? [];
          return query;
        }),
        getMany: jest.fn(async () =>
          words.filter(
            (word) =>
              !excluded.includes(word.id) &&
              (!cutoff || word.createdAt <= cutoff),
          ),
        ),
      };
      return query;
    });
    let messageId = 700;
    bot.telegram.sendMessage.mockImplementation(async () => ({
      message_id: ++messageId,
    }));
    return {
      ...fixture,
      words,
      state: () => ({ target, batches, items, decisions }),
      resetTarget: () => {
        target = null;
      },
    };
  };

  describe('persistent review controls and delivery', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-13T06:30:00Z'));
    });
    afterEach(() => jest.useRealTimers());

    it('starts today with ten words and schedules September 16 at 09:00 Tbilisi', async () => {
      const f = makeDelivery();
      f.resetTarget();
      await f.service.setTarget(-100, 44, 'admin');
      const result = await f.service.sendReviewBatch({ scheduled: true });
      expect(result.count).toBe(10);
      expect(f.state().target.batchSize).toBe(10);
      expect(f.state().target.nextRunAt).toEqual(
        new Date('2026-09-16T05:00:00Z'),
      );
      expect(f.state().batches[0].reviewFlow).toBe('dictionary');
    });

    it('allows setting a size before starting without enabling delivery', async () => {
      const f = makeDelivery();
      f.resetTarget();
      await f.service.setBatchSize(-100, 44, 25, 'admin');
      expect(f.state().target).toMatchObject({ batchSize: 25, enabled: false });
      await f.service.setTarget(-100, 44, 'admin');
      expect(f.state().target.batchSize).toBe(25);
      expect(f.bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it.each([0, -1, 101, 2.5, NaN, Infinity])(
      'rejects invalid size %s',
      async (size) => {
        const f = makeDelivery();
        await expect(
          f.service.setBatchSize(-100, 44, size, 'admin'),
        ).rejects.toThrow('целым числом');
        expect(f.configRepo.save).not.toHaveBeenCalled();
      },
    );

    it('preserves progress, size and schedule through stop and resume', async () => {
      const f = makeDelivery(20);
      await f.service.sendReviewBatch();
      const before = structuredClone(f.state());
      await f.service.clearTarget(-100, 44);
      expect(await f.service.sendReviewBatch()).toEqual({
        status: 'paused',
        count: 0,
      });
      expect(await f.service.sendReviewBatch({ scheduled: true })).toEqual({
        status: 'paused',
        count: 0,
      });
      await f.service.setTarget(-100, 44, 'admin');
      expect(f.state().target).toMatchObject({
        batchSize: 20,
        enabled: true,
        nextRunAt: before.target.nextRunAt,
        dictionaryCutoffAt: before.target.dictionaryCutoffAt,
      });
      expect(f.state().items).toEqual(before.items);
      expect(await f.service.sendReviewBatch({ scheduled: true })).toEqual({
        status: 'not_due',
        count: 0,
      });
      expect(f.bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('rejects management and manual delivery from another topic or group', async () => {
      const f = makeDelivery();
      await expect(f.service.setTarget(-100, 45, 'admin')).rejects.toThrow(
        'другой теме',
      );
      await expect(f.service.clearTarget(-101, 44)).rejects.toThrow(
        'Вызовите команду',
      );
      await expect(
        f.service.setBatchSize(-100, 45, 20, 'admin'),
      ).rejects.toThrow('Вызовите команду');
      await expect(
        f.service.sendReviewBatch({ chatId: -101, threadId: 44 }),
      ).rejects.toThrow('Вызовите команду');
      expect(f.bot.telegram.sendMessage).not.toHaveBeenCalled();
    });

    it('selects all original sources in dialect alphabet order and excludes new arrivals', async () => {
      const f = makeDelivery(4);
      f.words.splice(
        0,
        f.words.length,
        { ...f.words[0], id: 1, word: 'б', source: 'chat', translation: '' },
        { ...f.words[0], id: 2, word: 'â', source: 'etalon' },
        { ...f.words[0], id: 3, word: 'а', source: 'rabochy' },
        {
          ...f.words[0],
          id: 4,
          word: 'новое',
          createdAt: new Date('2026-09-13T07:00:00Z'),
        },
      );
      const result = await f.service.sendReviewBatch();
      expect(result.count).toBe(3);
      expect(f.state().items.map((entry) => entry.originalWord)).toEqual([
        'а',
        'â',
        'б',
      ]);
      expect(f.state().items[2].originalTranslation).toBe('');
    });

    it('finishes each alphabetical pass before starting over with additions', async () => {
      const f = makeDelivery(1);
      const sample = f.words[0];
      f.words.splice(
        0,
        f.words.length,
        { ...sample, id: 1, word: 'б' },
        { ...sample, id: 2, word: 'я' },
      );
      const firstCutoff = f.state().target.dictionaryCutoffAt;
      await f.service.sendReviewBatch({ scheduled: true });
      await f.service.recordDecision({
        request: { batchId: 1, mode: 'all', words: [] },
        chatId: -100,
        threadId: 44,
        userId: 42,
        username: 'admin',
        messageId: 900,
      });
      f.words.push(
        {
          ...sample,
          id: 3,
          word: 'а',
          createdAt: new Date('2026-09-13T07:00:00Z'),
        },
        {
          ...sample,
          id: 4,
          word: 'в',
          createdAt: new Date('2026-09-13T07:00:00Z'),
        },
      );
      jest.setSystemTime(new Date('2026-09-16T05:00:00Z'));
      expect(await f.service.getStatus()).toMatchObject({
        remainingWordCount: 1,
        waitingNextPassCount: 2,
      });
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().items.map((item) => item.originalWord)).toEqual([
        'б',
        'я',
      ]);
      expect(f.state().target.dictionaryCutoffAt).toEqual(firstCutoff);
      await f.service.recordDecision({
        request: { batchId: 2, mode: 'dispute', words: [{ position: 1 }] },
        chatId: -100,
        threadId: 44,
        userId: 42,
        username: 'admin',
        messageId: 901,
      });

      jest.setSystemTime(new Date('2026-09-19T05:00:00Z'));
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().items.map((item) => item.originalWord)).toEqual([
        'б',
        'я',
        'а',
      ]);
      expect(f.state().target.dictionaryCutoffAt).toEqual(
        new Date('2026-09-19T05:00:00Z'),
      );
      f.words.push({
        ...sample,
        id: 5,
        word: 'аа',
        createdAt: new Date('2026-09-19T06:00:00Z'),
      });
      jest.setSystemTime(new Date('2026-09-22T05:00:00Z'));
      expect(await f.service.getStatus()).toMatchObject({
        remainingWordCount: 1,
        waitingNextPassCount: 1,
      });
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().items.map((item) => item.originalWord)).toEqual([
        'б',
        'я',
        'а',
        'в',
      ]);
      jest.setSystemTime(new Date('2026-09-25T05:00:00Z'));
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().items.map((item) => item.originalWord)).toEqual([
        'б',
        'я',
        'а',
        'в',
        'аа',
      ]);
      expect(f.state().items[0].status).toBe('confirmed');
      expect(f.state().items[1].status).toBe('disputed');
      expect(new Set(f.state().items.map((item) => item.wordId)).size).toBe(5);
      expect(f.state().target.nextRunAt).toEqual(
        new Date('2026-09-28T05:00:00Z'),
      );
    });

    it('keeps a short final batch separate from the next pass', async () => {
      const f = makeDelivery(10);
      const sample = f.words[0];
      f.words.splice(1);
      f.words.push({
        ...sample,
        id: 2,
        word: 'а',
        createdAt: new Date('2026-09-13T06:15:00Z'),
      });
      expect((await f.service.sendReviewBatch()).count).toBe(1);
      expect(f.state().items.map((item) => item.wordId)).toEqual([1]);
      expect((await f.service.sendReviewBatch({ extra: true })).count).toBe(1);
      expect(f.state().items.map((item) => item.wordId)).toEqual([1, 2]);
      expect(f.state().batches).toHaveLength(2);
    });

    it('preserves the new pass snapshot when a multi-page delivery fails and resumes', async () => {
      const f = makeDelivery(15);
      const sample = f.words[0];
      f.words.splice(1);
      await f.service.sendReviewBatch({ scheduled: true });
      for (let index = 0; index < 15; index++)
        f.words.push({
          ...sample,
          id: index + 2,
          word: `б${index}`,
          translation: 'я'.repeat(350),
          createdAt: new Date('2026-09-14T05:00:00Z'),
        });
      jest.setSystemTime(new Date('2026-09-16T05:00:00Z'));
      f.bot.telegram.sendMessage
        .mockResolvedValueOnce({ message_id: 711 })
        .mockRejectedValueOnce(new Error('offline'));
      await expect(
        f.service.sendReviewBatch({ scheduled: true }),
      ).rejects.toThrow('offline');
      expect(f.state().target.dictionaryCutoffAt).toEqual(
        new Date('2026-09-16T05:00:00Z'),
      );
      f.words.push({
        ...sample,
        id: 17,
        word: 'а',
        createdAt: new Date('2026-09-16T06:00:00Z'),
      });
      jest.setSystemTime(new Date('2026-09-16T07:00:00Z'));
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().target.dictionaryCutoffAt).toEqual(
        new Date('2026-09-16T05:00:00Z'),
      );
      expect(f.state().items).toHaveLength(16);
      expect(f.state().batches).toHaveLength(2);
      expect(f.state().batches[1].status).toBe('published');
      expect(await f.service.getStatus()).toMatchObject({
        remainingWordCount: 0,
        waitingNextPassCount: 1,
      });
      expect(f.bot.telegram.sendMessage).toHaveBeenCalledTimes(4);
    });

    it('waits for the next scheduled slot when an exhausted dictionary receives new words', async () => {
      const f = makeDelivery();
      const sample = f.words[0];
      f.words.splice(0);
      expect(
        await f.service.sendReviewBatch({ scheduled: true }),
      ).toMatchObject({ status: 'no_words' });
      expect(f.state().batches).toHaveLength(0);
      f.words.push({ ...sample, createdAt: new Date('2026-09-14T05:00:00Z') });
      jest.setSystemTime(new Date('2026-09-15T05:00:00Z'));
      expect(
        await f.service.sendReviewBatch({ scheduled: true }),
      ).toMatchObject({ status: 'not_due' });
      jest.setSystemTime(new Date('2026-09-16T05:00:00Z'));
      const results = await Promise.all([
        f.service.sendReviewBatch({ scheduled: true }),
        f.service.sendReviewBatch({ scheduled: true }),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'sent',
        'not_due',
      ]);
      expect(f.state().batches).toHaveLength(1);
      expect(f.state().items).toHaveLength(1);
    });

    it('can start the next pass manually on pause without moving the schedule', async () => {
      const f = makeDelivery();
      const sample = f.words[0];
      f.words.splice(1);
      await f.service.sendReviewBatch({ scheduled: true });
      await f.service.clearTarget(-100, 44);
      const next = f.state().target.nextRunAt;
      f.words.push({
        ...sample,
        id: 2,
        word: 'а',
        createdAt: new Date('2026-09-13T07:00:00Z'),
      });
      jest.setSystemTime(new Date('2026-09-13T08:00:00Z'));
      expect((await f.service.sendReviewBatch({ extra: true })).count).toBe(1);
      expect(f.state().target.enabled).toBe(false);
      expect(f.state().target.nextRunAt).toEqual(next);
      expect(f.state().target.dictionaryCutoffAt).toEqual(
        new Date('2026-09-13T08:00:00Z'),
      );
    });

    it.each([7, 27])(
      'sends one hundred short words in a single message (translation length %i)',
      async (length) => {
        const f = makeDelivery(100);
        f.words.forEach((word) => {
          word.translation = 'я'.repeat(length);
        });
        await f.service.sendReviewBatch({ extra: true });
        expect(f.bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
        const [, text, options] = (f.bot.telegram.sendMessage as jest.Mock).mock
          .calls[0];
        expect(text).toContain('1. а000 — ' + 'я'.repeat(length));
        expect(text).toContain('100. а099 — ' + 'я'.repeat(length));
        if (length === 27) expect(text.length).toBeGreaterThan(3800);
        expect(text.length).toBeLessThanOrEqual(4096);
        expect(options.entities).toHaveLength(100);
        expect(f.state().items).toHaveLength(100);
      },
    );

    it('splits only at the message limit without repeating the heading', async () => {
      const f = makeDelivery(100);
      f.words.forEach((word) => {
        word.translation = 'я'.repeat(50);
      });
      await f.service.sendReviewBatch();
      const calls = (f.bot.telegram.sendMessage as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toContain('📚 Словарь');
      expect(calls[1][1]).not.toMatch(/Словарь|Обсуждение до/);
      const positions = calls.flatMap((call) =>
        Array.from(call[1].matchAll(/^(\d+)\. /gm), (match: any) =>
          Number(match[1]),
        ),
      );
      expect(positions).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
      expect(calls.every((call) => call[1].length <= 4096)).toBe(true);
    });

    it('delivers one hundred words in bounded pages with every word represented once', async () => {
      const f = makeDelivery(100);
      for (const word of f.words) {
        word.word = 'а'.repeat(255) + word.id;
        word.translation = 'я'.repeat(1000);
        word.partOfSpeech = 'с'.repeat(64);
      }
      expect((await f.service.sendReviewBatch()).count).toBe(100);
      const calls = (f.bot.telegram.sendMessage as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(10);
      expect(calls.every((call) => call[1].length <= 4096)).toBe(true);
      expect(calls.every((call) => call[2].reply_markup === undefined)).toBe(
        true,
      );
      const positions = calls.flatMap((call) =>
        Array.from(call[1].matchAll(/^(\d+)\. /gm), (match: any) =>
          Number(match[1]),
        ),
      );
      expect(positions).toEqual(
        Array.from({ length: 100 }, (_, index) => index + 1),
      );
      expect(calls.map((call) => call[1]).join('')).toContain('я'.repeat(1000));
    });

    it('makes only complete dialect words copyable across page boundaries', async () => {
      const f = makeDelivery(3);
      f.words.splice(
        0,
        f.words.length,
        {
          ...f.words[0],
          id: 1,
          word: 'â <&> 🦊',
          translation: 'я'.repeat(3560),
        },
        {
          ...f.words[0],
          id: 2,
          word: 'с'.repeat(250),
          translation: '🦊 '.repeat(1400),
        },
        {
          ...f.words[0],
          id: 3,
          word: 'ширин сâн',
          translation: 'укроп <растение> & трава',
        },
      );
      await f.service.sendReviewBatch();
      const calls = (f.bot.telegram.sendMessage as jest.Mock).mock.calls;
      const copiedWords = calls.flatMap((call) =>
        call[2].entities.map((entity) => {
          expect(entity.type).toBe('code');
          expect(entity.offset).toBeGreaterThanOrEqual(0);
          expect(entity.offset + entity.length).toBeLessThanOrEqual(
            call[1].length,
          );
          return call[1].slice(entity.offset, entity.offset + entity.length);
        }),
      );
      expect(copiedWords).toEqual(
        f.state().items.map((item) => item.originalWord),
      );
      expect(calls.every((call) => call[1].length <= 4096)).toBe(true);
      expect(
        calls.every((call) => !call[2].parse_mode && !call[2].reply_markup),
      ).toBe(true);
      expect(calls.map((call) => call[1]).join('')).toContain(
        'укроп <растение> & трава',
      );
    });

    it.each([false, true])(
      'resumes an interrupted multi-page delivery without resending completed pages (legacy: %s)',
      async (legacy) => {
        const f = makeDelivery(25);
        if (legacy) {
          f.batchRepo.create.mockImplementation((value) => ({
            ...value,
            messageFormatVersion: 1,
          }));
        } else {
          f.words.forEach((word) => {
            word.translation = 'я'.repeat(350);
          });
        }
        f.state().target.nextRunAt = new Date('2026-09-16T05:00:00Z');
        f.bot.telegram.sendMessage
          .mockResolvedValueOnce({ message_id: 701 })
          .mockRejectedValueOnce(new Error('temporary failure'));
        await expect(f.service.sendReviewBatch()).rejects.toThrow(
          'temporary failure',
        );
        expect(f.state().batches[0]).toMatchObject({
          status: 'sending',
          messageIds: [701],
        });
        expect(f.state().items).toHaveLength(25);
        await f.service.sendReviewBatch({ scheduled: true });
        expect(f.state().batches).toHaveLength(1);
        expect(f.state().batches[0].status).toBe('published');
        const calls = (f.bot.telegram.sendMessage as jest.Mock).mock.calls;
        expect(calls).toHaveLength(4);
        expect(calls[2][1]).toEqual(calls[1][1]);
        const delivered = [calls[0], ...calls.slice(2)];
        expect(
          delivered.flatMap((call) =>
            Array.from(call[1].matchAll(/^(\d+)\. /gm), (match: any) =>
              Number(match[1]),
            ),
          ),
        ).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
        if (legacy) expect(calls[2][1]).toContain('11. а010 — перевод');
      },
    );

    it('serializes simultaneous scheduled and manual delivery', async () => {
      const f = makeDelivery();
      const results = await Promise.all([
        f.service.sendReviewBatch({ scheduled: true }),
        f.service.sendReviewBatch({ extra: true }),
      ]);
      expect(results.map((result) => result.status)).toEqual(['sent', 'sent']);
      expect(f.bot.telegram.sendMessage).toHaveBeenCalledTimes(2);
      expect(f.state().batches).toHaveLength(2);
      expect(new Set(f.state().items.map((item) => item.wordId)).size).toBe(20);
    });

    it('does not duplicate a scheduled slot when two workers run together', async () => {
      const f = makeDelivery();
      const results = await Promise.all([
        f.service.sendReviewBatch({ scheduled: true }),
        f.service.sendReviewBatch({ scheduled: true }),
      ]);
      expect(results.map((result) => result.status)).toEqual([
        'sent',
        'not_due',
      ]);
      expect(f.state().batches).toHaveLength(1);
    });

    it('delivers extra words during discussion and on pause without moving even an overdue schedule', async () => {
      const f = makeDelivery();
      await f.service.sendReviewBatch({ scheduled: true });
      await f.service.clearTarget(-100, 44);
      const next = f.state().target.nextRunAt;
      jest.setSystemTime(new Date('2026-09-18T07:00:00Z'));
      await f.service.sendReviewBatch({ extra: true });
      expect(f.state().target.enabled).toBe(false);
      expect(f.state().target.nextRunAt).toEqual(next);
      expect(f.state().batches).toHaveLength(2);
      expect(
        f.state().batches.every((batch) => batch.status === 'published'),
      ).toBe(true);
      expect(f.state().batches[1].advanceSchedule).toBe(false);
    });

    it('delivers scheduled words while an earlier discussion is still open', async () => {
      const f = makeDelivery();
      await f.service.sendReviewBatch({ scheduled: true });
      jest.setSystemTime(new Date('2026-09-16T05:00:00Z'));
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().batches).toHaveLength(2);
      expect(f.state().batches[0].completedAt).toBeNull();
      expect(f.state().target.nextRunAt).toEqual(
        new Date('2026-09-19T05:00:00Z'),
      );
    });

    it('resumes an extra delivery without consuming the regular scheduled slot', async () => {
      const f = makeDelivery(25);
      f.words.forEach((word) => {
        word.translation = 'я'.repeat(350);
      });
      const next = f.state().target.nextRunAt;
      f.bot.telegram.sendMessage
        .mockResolvedValueOnce({ message_id: 701 })
        .mockRejectedValueOnce(new Error('network'));
      await expect(f.service.sendReviewBatch({ extra: true })).rejects.toThrow(
        'network',
      );
      await f.service.sendReviewBatch({ scheduled: true });
      expect(f.state().target.nextRunAt).toEqual(next);
      expect(f.state().batches).toHaveLength(1);
      expect(f.state().batches[0].status).toBe('published');
    });

    it('changes the size only for later batches and retains the next date after early manual delivery', async () => {
      const f = makeDelivery();
      f.state().target.nextRunAt = new Date('2026-09-16T05:00:00Z');
      await f.service.sendReviewBatch();
      await f.service.setBatchSize(-100, 44, 30, 'admin');
      expect(f.state().items).toHaveLength(10);
      expect(f.state().target.nextRunAt).toEqual(
        new Date('2026-09-16T05:00:00Z'),
      );
      expect(f.state().target.batchSize).toBe(30);
    });
  });

  describe('coordinator decisions', () => {
    const input = (request: ReviewDecisionRequest, messageId = 900) => ({
      request,
      chatId: -100,
      threadId: 44,
      userId: 42,
      username: 'coordinator',
      messageId,
    });

    it('records exceptions, then completes the batch when the remaining words are explicitly reviewed', async () => {
      const f = makeDelivery(4);
      await f.service.sendReviewBatch();
      const nextRunAt = f.state().target.nextRunAt;
      const partial = await f.service.recordDecision(
        input({ batchId: 1, mode: 'all_except', words: [{ position: 3 }] }),
      );
      expect(partial).toMatchObject({
        completed: false,
        confirmed: [
          { position: 1, word: 'а000' },
          { position: 2, word: 'а001' },
          { position: 4, word: 'а003' },
        ],
        disputed: [{ position: 3, word: 'а002' }],
        pending: [],
      });
      expect(f.state().items[2].confirmedAt).toBeNull();
      expect(f.state().decisions[0]).toMatchObject({
        userId: 42,
        username: 'coordinator',
        messageId: 900,
        batchId: 1,
      });
      expect(f.state().decisions[0].changes).toHaveLength(4);
      const done = await f.service.recordDecision(
        input({ batchId: 1, mode: 'confirm', words: [{ position: 3 }] }, 901),
      );
      expect(done).toMatchObject({
        completed: true,
        disputed: [],
        pending: [],
      });
      expect(done.confirmed).toHaveLength(4);
      expect(f.state().batches[0].completedAt.getTime()).toBeGreaterThan(0);
      expect(
        f.state().items.every((item) => item.confirmedAt?.getTime() > 0),
      ).toBe(true);
      expect(f.state().target.nextRunAt).toEqual(nextRunAt);
      expect(f.bot.telegram.sendMessage).toHaveBeenCalledTimes(1);
      const status = await f.service.getStatus();
      expect(status).toMatchObject({
        confirmedWordCount: 4,
        disputedWordCount: 0,
        openWordCount: 0,
        completedBatchCount: 1,
      });
    });

    it('leaves unlisted words open and works on pause', async () => {
      const f = makeDelivery(3);
      await f.service.sendReviewBatch();
      await f.service.clearTarget(-100, 44);
      const result = await f.service.recordDecision(
        input({ batchId: 1, mode: 'confirm', words: [{ position: 2 }] }),
      );
      expect(result.confirmed).toEqual([{ position: 2, word: 'а001' }]);
      expect(result.pending).toEqual([
        { position: 1, word: 'а000' },
        { position: 3, word: 'а002' },
      ]);
      expect(f.state().batches[0].completedAt).toBeNull();
      expect(f.state().target.enabled).toBe(false);
    });

    it('closes all words with an explicit batch decision', async () => {
      const f = makeDelivery(2);
      await f.service.sendReviewBatch();
      const result = await f.service.recordDecision(
        input({ batchId: 1, mode: 'all', words: [] }),
      );
      expect(result.completed).toBe(true);
      expect(result.confirmed).toHaveLength(2);
    });

    it('resolves a reply to any page while several batches are open', async () => {
      const f = makeDelivery(15);
      f.words.forEach((word) => {
        word.translation = 'я'.repeat(350);
      });
      await f.service.sendReviewBatch();
      await f.service.sendReviewBatch({ extra: true });
      const result = await f.service.recordDecision({
        ...input({ mode: 'confirm', words: [{ position: 12 }] }),
        replyToMessageId: 702,
      });
      expect(result).toMatchObject({
        batchId: 1,
        confirmed: [{ position: 12, word: 'а011' }],
      });
      expect(
        f
          .state()
          .items.filter((item) => item.batchId === 2)
          .every((item) => item.status === 'discussion'),
      ).toBe(true);
    });

    it('resolves an exact word name without choosing the latest batch', async () => {
      const f = makeDelivery(2);
      f.words[0].word = 'аа ширин';
      await f.service.sendReviewBatch();
      await f.service.sendReviewBatch({ extra: true });
      const result = await f.service.recordDecision(
        input({ mode: 'confirm', words: [{ word: 'АА  ширин' }] }),
      );
      expect(result.batchId).toBe(1);
      expect(result.confirmed).toHaveLength(1);
    });

    it.each([
      [{ mode: 'all', words: [] }, {}, 'определить партию'],
      [
        {
          batchId: 1,
          mode: 'confirm',
          words: [{ position: 1 }, { position: 99 }],
        },
        {},
        'не найдено',
      ],
      [{ batchId: 1, mode: 'all', words: [] }, { threadId: 45 }, 'в теме'],
      [{ batchId: 1, mode: 'all', words: [] }, { chatId: -200 }, 'в теме'],
      [{ batchId: 1, mode: 'all', words: [] }, { userId: 0 }, 'автора'],
      [
        { batchId: 1, mode: 'all', words: [] },
        { messageId: undefined },
        'автора',
      ],
      [
        { batchId: 2, mode: 'all', words: [] },
        { replyToMessageId: 701 },
        'не совпадает',
      ],
    ])(
      'rejects unclear or mismatched decisions without saving any part',
      async (request, overrides, error) => {
        const f = makeDelivery(3);
        await f.service.sendReviewBatch();
        await f.service.sendReviewBatch({ extra: true });
        const before = structuredClone(f.state());
        await expect(
          f.service.recordDecision({
            ...input(request as ReviewDecisionRequest),
            ...overrides,
          }),
        ).rejects.toThrow(error);
        expect(f.state()).toEqual(before);
      },
    );

    it('does not finalize a delivery that failed before its last page', async () => {
      const f = makeDelivery(15);
      f.words.forEach((word) => {
        word.translation = 'я'.repeat(350);
      });
      f.bot.telegram.sendMessage
        .mockResolvedValueOnce({ message_id: 701 })
        .mockRejectedValueOnce(new Error('offline'));
      await expect(f.service.sendReviewBatch()).rejects.toThrow('offline');
      await expect(
        f.service.recordDecision(input({ batchId: 1, mode: 'all', words: [] })),
      ).rejects.toThrow('не опубликована полностью');
      expect(f.state().decisions).toHaveLength(0);
    });

    it('requires a batch number when a name matches several review items', async () => {
      const f = makeDelivery(1);
      await f.service.sendReviewBatch();
      await f.service.sendReviewBatch({ extra: true });
      f.state().items[1].originalWord = 'а000';
      await expect(
        f.service.recordDecision(
          input({ mode: 'confirm', words: [{ word: 'а000' }] }),
        ),
      ).rejects.toThrow('однозначно');
      expect(f.state().decisions).toHaveLength(0);
    });

    it('serializes simultaneous partial decisions and completes their combined result', async () => {
      const f = makeDelivery(2);
      await f.service.sendReviewBatch();
      await Promise.all([
        f.service.recordDecision(
          input({ batchId: 1, mode: 'confirm', words: [{ position: 1 }] }, 901),
        ),
        f.service.recordDecision(
          input({ batchId: 1, mode: 'confirm', words: [{ position: 2 }] }, 902),
        ),
      ]);
      expect(f.state().items.every((item) => item.status === 'confirmed')).toBe(
        true,
      );
      expect(f.state().batches[0].status).toBe('completed');
    });

    it('preserves audit history and does not replay an old confirmation after a dispute is reopened', async () => {
      const f = makeDelivery(2);
      await f.service.sendReviewBatch();
      const original = input({ batchId: 1, mode: 'all', words: [] });
      await f.service.recordDecision(original);
      await f.service.recordDecision(
        input({ batchId: 1, mode: 'dispute', words: [{ position: 1 }] }, 901),
      );
      const result = await f.service.recordDecision(original);
      expect(result).toMatchObject({
        alreadyApplied: true,
        completed: false,
        disputed: [{ position: 1, word: 'а000' }],
      });
      expect(f.state().batches[0].completedAt).toBeNull();
      expect(f.state().items[0].confirmedAt).toBeNull();
      expect(f.state().decisions).toHaveLength(2);
      expect(f.state().decisions[1].changes[0]).toMatchObject({
        previousStatus: 'confirmed',
        status: 'disputed',
      });
    });
  });

  it('publishes a plain list with a human discussion deadline and no votes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-13T06:30:00Z'));
    try {
      const f = makeDelivery();
      await f.service.sendReviewBatch();
      const call = (f.bot.telegram.sendMessage as jest.Mock).mock.calls[0];
      expect(call[1]).toContain('📚 Словарь · партия №1 · 10 слов');
      expect(call[1]).toContain('14.09.2026, 21:00 МСК');
      expect(call[1]).toContain('1. а000 — перевод');
      expect(call[1]).not.toMatch(
        /голос|Верно|0\/3|Обсуждайте свободно|Итоги подводят|Катя|Жанна/,
      );
      expect(call[2]).toEqual({
        message_thread_id: 44,
        entities: expect.any(Array),
      });
      expect(call[2].entities).toHaveLength(10);
      expect(
        call[2].entities.map((entity) =>
          call[1].slice(entity.offset, entity.offset + entity.length),
        ),
      ).toEqual(f.state().items.map((item) => item.originalWord));
      expect(f.state().batches[0].status).toBe('published');
      expect(
        f.state().items.every((entry) => entry.status === 'discussion'),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
