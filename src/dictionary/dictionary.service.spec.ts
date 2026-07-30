import { DictionaryService } from './dictionary.service';

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
