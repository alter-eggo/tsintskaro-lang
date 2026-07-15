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
