import {
  actionWords,
  parseDictionaryActions,
  dictionarySnapshot,
  DICTIONARY_ACTIONS_SCHEMA,
} from './dictionary-actions';
import { DictionaryService } from './dictionary.service';

describe('model dictionary operations', () => {
  it('normalizes spelling while preserving diacritics, glosses and sense numbers', () => {
    const result = parseDictionaryActions([
      {
        type: 'move_example',
        word: '  АВАСЫНАН  ЭТМАХ ',
        target: 'Авâс'.normalize('NFD'),
        sense: 2,
        translation: 'Делать с настроением',
        phrase: null,
        createSense: null,
      },
    ]);
    expect(result).toEqual([
      {
        type: 'move_example',
        word: 'авасынан этмах',
        target: 'авâс',
        sense: 2,
        translation: 'Делать с настроением',
      },
    ]);
    expect(actionWords(result!)).toEqual(['авасынан этмах', 'авâс']);
  });

  it.each([
    { type: 'set_sense', word: 'авара', sense: 0, translation: 'test' },
    { type: 'set_sense', word: 'авара', sense: '3', translation: 'test' },
    { type: 'set_sense', word: 'авара', sense: 1.5, translation: 'test' },
    { type: 'move_example', word: 'авара дурмах', sense: 1 },
    { type: 'update_word', word: 'авара' },
    { type: 'delete_word', word: '' },
    { type: 'delete_word', word: 'авария', canRemoveEntry: true },
    { type: 'set_kind', word: 'авара', kind: 'существительное' },
    { type: 'set_status', word: 'авара', status: 'deleted' },
    { type: '__proto__', word: 'авара' },
  ])('rejects an entire plan containing an invalid action: %j', (invalid) => {
    expect(
      parseDictionaryActions([
        { type: 'delete_word', word: 'агроном' },
        invalid,
      ]),
    ).toBeNull();
  });

  it('has a strict schema for every operation and makes nullable fields required for the API', () => {
    for (const schema of DICTIONARY_ACTIONS_SCHEMA.items.anyOf) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required.sort()).toEqual(
        Object.keys(schema.properties).sort(),
      );
    }
  });

  it('detects a changed sense even if the materialized translation stayed the same', () => {
    const row = {
      id: 1,
      word: 'авара',
      translation: 'бездельник',
      senses: [{ translation: 'бездельник', examples: [] }],
    } as any;
    const before = dictionarySnapshot(row.word, row);
    row.senses[0].examples.push({
      phrase: 'авара дурмах',
      translation: 'бездельничать',
    });
    expect(dictionarySnapshot(row.word, row).version).not.toBe(before.version);
  });

  it.each([
    { type: 'set_sense', word: 'авара', sense: 1, translation: 'новое' },
    { type: 'move_example', word: 'авара дурмах', target: 'авара', sense: 1 },
    { type: 'set_kind', word: 'авара', kind: 'idiom' },
  ])(
    'does not grant translation rights to an unlisted user for %j',
    async (action) => {
      const transaction = jest.fn();
      const service = new DictionaryService({
        manager: { transaction },
      } as any);
      await expect(
        service.applyActions(
          [action as any],
          { userId: 42, username: 'participant', canRemoveEntry: true },
          [],
        ),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('keeps removal permission separate even for a translation editor', async () => {
    const transaction = jest.fn();
    const service = new DictionaryService({ manager: { transaction } } as any);
    await expect(
      service.applyActions(
        [{ type: 'delete_word', word: 'авария' }],
        { userId: 42, username: 'Elvardi', canRemoveEntry: false },
        [],
      ),
    ).rejects.toThrow();
    expect(transaction).not.toHaveBeenCalled();
  });
});
