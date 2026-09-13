import { DictionaryService } from './dictionary.service';
import { Word } from './entities/word.entity';

describe('DictionaryService relevant prompt entries', () => {
  const makeService = (
    rows: Array<{
      word: string;
      translation: string;
      partOfSpeech?: string | null;
    }>,
  ) => {
    const repo = {
      find: jest.fn(async () =>
        rows.map((row) => ({
          ...row,
          partOfSpeech: row.partOfSpeech ?? null,
        })),
      ),
    };
    return new DictionaryService(repo as any);
  };

  it('refreshes dictionary entries changed by another application within one minute', async () => {
    const rows = [{ word: 'ширин', translation: 'сладкий' }];
    const service = makeService(rows);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      expect((await service.findWord('ширин'))?.translation).toBe('сладкий');
      rows[0].translation = 'сладкий; милый';
      rows.push({ word: 'хатâ', translation: 'проблема' });
      now.mockReturnValue(61001);
      expect((await service.findWord('ширин'))?.translation).toBe(
        'сладкий; милый',
      );
      expect((await service.findWord('хатâ'))?.translation).toBe('проблема');
    } finally {
      now.mockRestore();
    }
  });

  it('finds exact, multi-word, hyphenated, and folded matches', async () => {
    const service = makeService([
      { word: 'сахгкал оти', translation: 'укроп' },
      { word: 'шûла-пûлав', translation: 'поминальное блюдо' },
      { word: 'сŷпŷрджâ', translation: 'веник' },
      { word: 'ай', translation: 'луна' },
    ]);

    const result = await service.findRelevantForPrompt([
      'Сахгкал оти положили в блюдо. Шûла пûлав готова.',
      'Возьми сŷпŷpджâ, но давай без спешки.',
    ]);

    expect(result.map((entry) => entry.word)).toHaveLength(3);
    expect(result.map((entry) => entry.word)).toEqual(
      expect.arrayContaining(['сахгкал оти', 'сŷпŷрджâ', 'шûла-пûлав']),
    );
    expect(result.some((entry) => entry.word === 'ай')).toBe(false);
  });

  it('ranks frequent matches first and respects the limit', async () => {
    const service = makeService([
      { word: 'ширин', translation: 'сладкий' },
      { word: 'хатâ', translation: 'проблема' },
    ]);

    const result = await service.findRelevantForPrompt(
      ['Ширин, ширин. Хатâ тоже была.'],
      1,
    );

    expect(result).toEqual([
      expect.objectContaining({ word: 'ширин', translation: 'сладкий' }),
    ]);
  });

  it('returns no entries when messages do not contain dictionary words', async () => {
    const service = makeService([{ word: 'ширин', translation: 'сладкий' }]);

    await expect(
      service.findRelevantForPrompt(['Обычное русское сообщение.']),
    ).resolves.toEqual([]);
  });

  it('finds a Russian word inside a longer dictionary translation', async () => {
    const service = makeService([
      { word: 'махсыл', translation: 'хороший урожай' },
      { word: 'ôйхмâт', translation: 'государство, страна' },
    ]);

    await expect(service.findByTranslation('урожай')).resolves.toEqual([
      expect.objectContaining({
        word: 'махсыл',
        translation: 'хороший урожай',
      }),
    ]);
    await expect(service.findByTranslation('рана')).resolves.toEqual([]);
  });
});

describe('DictionaryService word upserts', () => {
  const makeService = (rows: any[]) => {
    const repo = {
      findOne: jest.fn(async ({ where: { word } }) =>
        rows.find((row) => row.word === word),
      ),
      find: jest.fn(async () => rows),
      save: jest.fn(async (row) => row),
      create: jest.fn((row) => ({ id: rows.length + 1, ...row })),
    };

    return { service: new DictionaryService(repo as any), repo };
  };

  it('recognizes an existing word with mixed Latin and Cyrillic letters', async () => {
    const existing = {
      id: 1,
      word: 'сŷпŷрджâ',
      translation: 'веник',
      partOfSpeech: null,
      source: 'etalon',
      addedBy: null,
    };
    const { service, repo } = makeService([existing]);

    const result = await service.upsertWord({
      word: 'сŷпŷpджâ',
      translation: 'веник',
    });

    expect(result).toEqual({
      created: false,
      word: existing,
      translationAdded: false,
    });
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not merge a new visible spelling through broad lookup folding', async () => {
    const existing = {
      id: 1,
      word: 'сŷртмах',
      translation: 'намазать',
      partOfSpeech: null,
      source: 'etalon',
      addedBy: null,
    };
    const { service, repo } = makeService([existing]);

    const result = await service.upsertWord({
      word: 'суртмах',
      translation: 'другое значение',
      addedBy: 'user',
    });

    expect(result.created).toBe(true);
    expect(result.word.word).toBe('суртмах');
    expect(existing.translation).toBe('намазать');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        word: 'суртмах',
        translation: 'другое значение',
      }),
    );
    expect(repo.save).not.toHaveBeenCalledWith(existing);
  });

  it('adds only translation variants that are not already present', async () => {
    const existing = {
      id: 1,
      word: 'ширин',
      translation: 'сладкий, сахарный',
      partOfSpeech: null,
      source: 'etalon',
      addedBy: null,
    };
    const { service, repo } = makeService([existing]);

    const result = await service.upsertWord({
      word: 'Ширин',
      translation: 'сахарный; приятный; приятный',
    });

    expect(result.created).toBe(false);
    expect(result.translationAdded).toBe(true);
    expect(result.addedTranslation).toBe('приятный');
    expect(result.word.translation).toBe('приятный; сладкий, сахарный');
    expect(repo.save).toHaveBeenCalledWith(existing);
  });

  it('does not write when every incoming translation variant already exists', async () => {
    const existing = {
      id: 1,
      word: 'âйсûч',
      translation: 'меньше; нехватка',
      partOfSpeech: null,
      source: 'chat',
      addedBy: 'user',
    };
    const { service, repo } = makeService([existing]);

    const result = await service.upsertWord({
      word: 'âйсûч',
      translation: 'меньше, нехватка',
    });

    expect(result.translationAdded).toBe(false);
    expect(result.word.translation).toBe('меньше; нехватка');
    expect(repo.save).not.toHaveBeenCalled();
  });
});

describe('DictionaryService explicit translation replacement', () => {
  const makeReplacement = () => {
    const row = {
      id: 5,
      word: 'ширин',
      translation: 'сахарный; сладкий',
      partOfSpeech: 'прил.',
      source: 'etalon',
      addedBy: 'original-author',
    };
    const history = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const repo = {
      find: jest.fn(async () => [{ ...row }]),
      findOne: jest.fn(async (options) =>
        options.where.word === row.word ? { ...row } : null,
      ),
      update: jest.fn(async (_criteria, values) => {
        Object.assign(row, values);
        return { affected: 1 };
      }),
      manager: { transaction: jest.fn() },
    };
    repo.manager.transaction.mockImplementation(async (action) =>
      action({ getRepository: (entity) => (entity === Word ? repo : history) }),
    );
    const input = {
      word: 'Ширин',
      translation: 'сладкий',
      userId: 42,
      username: 'editor',
      chatId: -100,
      threadId: 44,
      messageId: 777,
    };
    return {
      row,
      repo,
      history,
      input,
      service: new DictionaryService(repo as any),
    };
  };

  it('replaces rather than appends while preserving word provenance and other fields', async () => {
    const f = makeReplacement();
    const result = await f.service.replaceTranslation(f.input);
    expect(result).toEqual({
      status: 'updated',
      word: 'ширин',
      previousTranslation: 'сахарный; сладкий',
      translation: 'сладкий',
    });
    expect(f.row).toMatchObject({
      translation: 'сладкий',
      source: 'etalon',
      addedBy: 'original-author',
      partOfSpeech: 'прил.',
    });
    expect(f.repo.update).toHaveBeenCalledWith(
      { id: 5 },
      { translation: 'сладкий' },
    );
    expect(f.repo.findOne).toHaveBeenCalledWith({
      where: { word: 'ширин' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(f.history.save).toHaveBeenCalledWith(
      expect.objectContaining({
        wordId: 5,
        previousTranslation: 'сахарный; сладкий',
        translation: 'сладкий',
        userId: 42,
        username: 'editor',
        chatId: -100,
        threadId: 44,
        messageId: 777,
      }),
    );
  });

  it('invalidates cached lookup answers after replacement', async () => {
    const f = makeReplacement();
    expect((await f.service.findWord('ширин'))?.translation).toBe(
      'сахарный; сладкий',
    );
    await f.service.replaceTranslation(f.input);
    expect((await f.service.findWord('ширин'))?.translation).toBe('сладкий');
  });

  it('does not create new records or fuzzy-match a different spelling', async () => {
    const f = makeReplacement();
    expect(
      await f.service.replaceTranslation({ ...f.input, word: 'шырин' }),
    ).toEqual({ status: 'not_found', word: 'шырин' });
    expect(f.repo.update).not.toHaveBeenCalled();
    expect(f.history.save).not.toHaveBeenCalled();
  });

  it('does not duplicate history for an unchanged translation', async () => {
    const f = makeReplacement();
    const result = await f.service.replaceTranslation({
      ...f.input,
      translation: 'сахарный; сладкий',
    });
    expect(result.status).toBe('unchanged');
    expect(f.repo.update).not.toHaveBeenCalled();
    expect(f.history.save).not.toHaveBeenCalled();
  });

  it('does not change the word if saving its history fails', async () => {
    const f = makeReplacement();
    f.history.save.mockRejectedValueOnce(new Error('database failure'));
    await expect(f.service.replaceTranslation(f.input)).rejects.toThrow(
      'database failure',
    );
    expect(f.repo.update).not.toHaveBeenCalled();
    expect(f.row.translation).toBe('сахарный; сладкий');
  });

  it.each(['', '   ', '\n'])(
    'rejects an empty translation %s',
    async (translation) => {
      const f = makeReplacement();
      expect(
        (await f.service.replaceTranslation({ ...f.input, translation }))
          .status,
      ).toBe('invalid');
      expect(f.repo.manager.transaction).not.toHaveBeenCalled();
    },
  );
});
