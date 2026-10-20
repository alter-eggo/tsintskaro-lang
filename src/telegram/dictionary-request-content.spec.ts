import { requestContent } from './dictionary-request-content';
import { DictionaryRequest } from './entities/dictionary-request.entity';

describe('dictionary request content', () => {
  const content = (parts: DictionaryRequest['parts']) =>
    requestContent({ parts } as DictionaryRequest);

  it.each([
    'В порядке обсуждения:\n1. слово — значение',
    '@AAlxnv, исправь:\n1. слово — значение',
  ])(
    'does not turn legacy discussion into authorized corrections: %s',
    (text) => {
      expect(content([{ messageId: 1, text }]).items).toEqual([]);
    },
  );

  it('uses recorded addressing metadata instead of inferring permission from text', () => {
    expect(
      content([
        {
          messageId: 1,
          text: 'Баласи, исправь:\n1. слово — значение',
          addressed: false,
        },
      ]).items,
    ).toEqual([]);
    expect(
      content([
        {
          messageId: 1,
          text: '@actual_bot, исправь:\n1. слово — значение',
          addressed: true,
        },
      ]).items,
    ).toEqual([1]);
  });

  it('does not silently choose between conflicting duplicates inside one addressed message', () => {
    const result = content([
      {
        messageId: 1,
        text: 'Баласи, исправь:\n1. слово — значение А\n1. слово — значение Б',
        addressed: true,
      },
    ]);
    expect(result.conflicts).toEqual([1]);
  });

  it('preserves multiline item text and explicitly marked clarification after duplicate delivery', () => {
    const original = {
      messageId: 1,
      text: 'Баласи, исправь:\n1. слово — значение\nЧасть речи — существительное.',
      addressed: true,
    };
    const parts = [
      original,
      {
        messageId: 2,
        text: '1. слово — значение\nЧасть речи — существительное.',
        addressed: false,
      },
      {
        messageId: 3,
        text: 'Баласи, пример оставь без изменений.',
        addressed: true,
        clarification: true,
      },
    ];
    const before = structuredClone(parts);
    const result = content(parts);
    expect(result.items).toEqual([1]);
    expect(result.conflicts).toEqual([]);
    expect(result.text).toContain(original.text);
    expect(result.text.match(/Часть речи/g)).toHaveLength(1);
    expect(result.text).toContain(
      'Уточнение редактора:\nБаласи, пример оставь без изменений.',
    );
    expect(parts).toEqual(before);
  });
});
