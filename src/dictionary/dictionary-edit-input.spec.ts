import { parseDictionaryEdit } from './dictionary-edit-input';
import { getSenses, mergeSenses, renderSenses } from './dictionary-content';
import { extractPartOfSpeech } from './dictionary-input';

describe('dictionary record commands', () => {
  it('parses Edik’s two transfers without inventing a gloss or part of speech', () => {
    expect(
      parseDictionaryEdit(
        'Баласи, перенеси «авара дурмах» в запись слова «авара» как пример к значению 1. Перевод примера — «бездельничать».',
      ),
    ).toEqual({
      type: 'move_example',
      word: 'авара дурмах',
      target: 'авара',
      sense: 1,
      createSense: false,
      translation: 'бездельничать',
    });
    expect(
      parseDictionaryEdit(
        'Баласи, перенеси «аваралых этмах» в запись слова «аваралых» как пример к новому значению 3. Само значение пока оставь пустым. Перевод примера — «заниматься ерундой».',
      ),
    ).toEqual({
      type: 'move_example',
      word: 'аваралых этмах',
      target: 'аваралых',
      sense: 3,
      createSense: true,
      translation: 'заниматься ерундой',
    });
  });

  it.each([
    ['Баласи, измени значение 3 слова «аваралых» на «ерунда».', 'set_sense'],
    ['Баласи, добавь значение 2 слова «авас» — «восхищение».', 'set_sense'],
    [
      'Баласи, укажи для значения 1 слова «ахгыран» часть речи «причастие».',
      'set_sense_pos',
    ],
    [
      'Баласи, измени перевод примера «авара дурмах» у слова «авара» в значении 1 на «бездельничать».',
      'set_example',
    ],
    [
      'Баласи, добавь к значению 1 слова «авас» пример «авасынан этмах» — «делать с настроением».',
      'add_example',
    ],
    [
      'Баласи, укажи тип записи «ахгзû гхырых» — фразеологизм. Буквально: «рот сломан».',
      'set_kind',
    ],
    [
      'Баласи, отложи запись «авария»: до решения о заимствованиях.',
      'set_status',
    ],
    ['Баласи, верни запись «авария» в словарь.', 'set_status'],
  ])('understands %s', (text, type) =>
    expect(parseDictionaryEdit(text)).toMatchObject({ type }),
  );

  it.each([
    'Баласи, перенеси «авара дурмах» в «авара».',
    'Баласи, перенеси «аваралых этмах» в запись «аваралых» как пример к новому значению 3.',
    'Баласи, перенеси «авара дурмах» в запись «авара» как пример к значению 1. И удали всё.',
    'Баласи, измени значение 3 на ерунда',
    'Баласи, исправь: авара дурмах — перенести как пример слова авара',
  ])(
    'rejects incomplete or mixed commands rather than adding text: %s',
    (text) => expect(parseDictionaryEdit(text)).toBe('invalid'),
  );

  it.each([
    'В порядке обсуждения: необходимо перенести как пример слова авара',
    'Баласи, как перенести выражение в примеры?',
    'Баласи, не переноси «авара дурмах»',
    'Эдик сказал: перенеси «авара дурмах» в запись «авара» как пример к значению 1',
    'агошка — окно, комментарий — нет',
  ])('does not treat discussion as an edit: %s', (text) =>
    expect(parseDictionaryEdit(text)).toBeNull(),
  );

  it('recognizes participles separately from the translation', () => {
    expect(extractPartOfSpeech('болеющий, часть речи — причастие')).toEqual({
      translation: 'болеющий',
      partOfSpeech: 'причастие',
    });
  });
});

describe('meanings and examples', () => {
  it('keeps synonyms together and splits only numbered senses', () => {
    expect(
      getSenses({ translation: 'молчун, стеснительный; бесхарактерный' }),
    ).toHaveLength(1);
    expect(
      getSenses({ translation: '1) безделье; 2) перерыв' }).map(
        (s) => s.translation,
      ),
    ).toEqual(['безделье', 'перерыв']);
    expect(() => getSenses({ translation: '1) безделье; 3) перерыв' })).toThrow(
      'Нумерация',
    );
  });
  it('prints a blank meaning with its example and keeps POS at its own meaning', () => {
    expect(
      renderSenses([
        { translation: 'безделье', examples: [] },
        { translation: 'перерыв', examples: [] },
        {
          translation: null,
          examples: [
            { phrase: 'аваралых этмах', translation: 'заниматься ерундой' },
          ],
        },
      ]),
    ).toBe('1) безделье; 2) перерыв; 3) аваралых этмах — заниматься ерундой');
    expect(
      renderSenses([
        { translation: 'болеющий', partOfSpeech: 'причастие', examples: [] },
      ]),
    ).toBe('болеющий (причастие)');
  });
  it('retains both translations when spellings are merged', () => {
    const merged = mergeSenses(
      getSenses({ translation: 'побелить, осветлить' }),
      getSenses({ translation: 'побелить' }),
    );
    expect(renderSenses(merged)).toBe('1) побелить, осветлить; 2) побелить');
  });
});
