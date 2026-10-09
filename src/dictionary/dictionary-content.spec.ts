import { getSenses, mergeSenses, renderSenses } from './dictionary-content';

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
    expect(() =>
      getSenses({ translation: '3) ерунда; 1) безделье; 2) перерыв' }),
    ).toThrow('Нумерация');
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
