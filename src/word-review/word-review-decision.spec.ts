import { parseReviewDecision } from './word-review-decision';

describe('explicit review decisions', () => {
  it.each([
    ['Баласи, партия №5 разобрана.', { batchId: 5, mode: 'all', words: [] }],
    [
      '@ourbot партия 5 полностью проверена!',
      { batchId: 5, mode: 'all', words: [] },
    ],
    ['Партия разобрана', { mode: 'all', words: [] }],
    [
      'Баласи, партия №5 разобрана, кроме слов 3 и 7.',
      {
        batchId: 5,
        mode: 'all_except',
        words: [{ position: 3 }, { position: 7 }],
      },
    ],
    [
      'Баласи, партия №5 разобрана. Слова 3 и 7 пока спорные.',
      {
        batchId: 5,
        mode: 'all_except',
        words: [{ position: 3 }, { position: 7 }],
      },
    ],
    [
      'Баласи, в партии №5 разобраны слова 1, 2 и 4.',
      {
        batchId: 5,
        mode: 'confirm',
        words: [{ position: 1 }, { position: 2 }, { position: 4 }],
      },
    ],
    [
      'Слова 3 и 7 разобраны',
      { mode: 'confirm', words: [{ position: 3 }, { position: 7 }] },
    ],
    [
      'Баласи, слово ширин проверено',
      { mode: 'confirm', words: [{ word: 'ширин' }] },
    ],
    [
      'Баласи, в партии №5 слова «Ширин сâн», спанах разобраны.',
      {
        batchId: 5,
        mode: 'confirm',
        words: [{ word: 'ширин сâн' }, { word: 'спанах' }],
      },
    ],
    [
      'В партии №5 слова 3 и 7 спорные',
      {
        batchId: 5,
        mode: 'dispute',
        words: [{ position: 3 }, { position: 7 }],
      },
    ],
  ])('parses the full instruction: %s', (text, expected) => {
    expect(parseReviewDecision(text)).toEqual(expected);
  });

  it.each([
    'Баласи, партия №5 разобрана?',
    'Баласи, партия №5 не разобрана',
    'Баласи, слово ширин не разобрано',
    'Баласи, слова ширин и спанах ещё не проверены',
    'Баласи, кажется, партия №5 разобрана',
    'Баласи, если партия №5 разобрана, пришли следующую',
    'Баласи, Катя сказала: «партия №5 разобрана»',
    'Баласи, партия №5 разобрана не полностью',
    'Баласи, партия №5 разобрана, но слово 3 ещё спорное',
    'Баласи, партия №5 разобрана, кроме слов',
    'Баласи, партия №5 разобрана. Не закрывай слово 3',
    'Баласи, партия №0 разобрана',
    'Баласи, в партии №5 разобраны слова 1, 101',
  ])(
    'does not infer approval from questions, quotations or incomplete instructions: %s',
    (text) => {
      expect(parseReviewDecision(text)).toBe('invalid');
    },
  );

  it.each([
    'Мне кажется, перевод неправильный',
    'Баласи, замени перевод слова ширин на проверено',
    'Баласи, добавь слово проверенный — разобранный',
  ])('leaves discussion and dictionary actions alone: %s', (text) => {
    expect(parseReviewDecision(text)).toBeNull();
  });
});
