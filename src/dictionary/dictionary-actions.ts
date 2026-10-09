import { createHash } from 'node:crypto';
import type { DictionaryEdit } from './dictionary-edit';
import type { Word } from './entities/word.entity';
import { getSenses } from './dictionary-content';

export type DictionaryAction =
  | DictionaryEdit
  | {
      type: 'add_word';
      word: string;
      translation: string;
      partOfSpeech?: string;
    }
  | {
      type: 'update_word';
      word: string;
      newWord?: string;
      translation?: string;
      partOfSpeech?: string;
    }
  | { type: 'delete_word'; word: string };

type Field = {
  type: 'string' | 'integer' | 'boolean';
  optional?: boolean;
  enum?: readonly string[];
};
const text: Field = { type: 'string' };
const optionalText: Field = { ...text, optional: true };
const sense: Field = { type: 'integer' };
const createSense: Field = { type: 'boolean', optional: true };
const definitions: Record<DictionaryAction['type'], Record<string, Field>> = {
  add_word: { word: text, translation: text, partOfSpeech: optionalText },
  update_word: {
    word: text,
    newWord: optionalText,
    translation: optionalText,
    partOfSpeech: optionalText,
  },
  delete_word: { word: text },
  move_example: {
    word: text,
    target: text,
    sense,
    createSense,
    translation: optionalText,
    phrase: optionalText,
  },
  add_example: { word: text, sense, phrase: text, translation: text },
  set_example: { word: text, sense, phrase: text, translation: text },
  set_sense: { word: text, sense, translation: text, createSense },
  set_sense_pos: { word: text, sense, partOfSpeech: text },
  set_kind: {
    word: text,
    kind: { ...text, enum: ['word', 'idiom', 'proverb'] },
    literalTranslation: optionalText,
  },
  set_status: {
    word: text,
    status: { ...text, enum: ['active', 'deferred'] },
    reason: optionalText,
  },
};

export const DICTIONARY_ACTIONS_SCHEMA = {
  type: 'array',
  items: {
    anyOf: Object.entries(definitions).map(([type, fields]) => ({
      type: 'object',
      description:
        type === 'move_example'
          ? 'Перенести запись в примеры. Если редакторский комментарий исправляет перевод выражения, обязательно передай исправленный перевод в translation; null оставляет старый перевод. sense — номер значения основной записи.'
          : type === 'set_sense'
            ? 'Добавить или изменить только одно значение. Простой старый перевод уже является значением 1: сохраняется автоматически, его заново создавать не нужно. Для следующего нового значения createSense=true.'
            : `Операция ${type}. Меняй только явно запрошенные поля.`,
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: [type] },
        ...Object.fromEntries(
          Object.entries(fields).map(([name, field]) => [
            name,
            {
              type: field.optional ? [field.type, 'null'] : field.type,
              ...(field.enum ? { enum: field.enum } : {}),
              ...(field.type === 'integer' ? { minimum: 1 } : {}),
            },
          ]),
        ),
      },
      required: ['type', ...Object.keys(fields)],
    })),
  },
};

export function dictionaryWord(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Validate the whole model plan; never silently execute only its valid subset. */
export function parseDictionaryActions(
  raw: unknown,
): DictionaryAction[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const actions: DictionaryAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (!Object.prototype.hasOwnProperty.call(definitions, item.type))
      return null;
    const fields = definitions[item.type as DictionaryAction['type']];
    if (
      Object.keys(item).some(
        (key) =>
          key !== 'type' && !Object.prototype.hasOwnProperty.call(fields, key),
      )
    )
      return null;
    const action: Record<string, unknown> = { type: item.type };
    for (const [key, field] of Object.entries(fields)) {
      const value = item[key];
      if (value == null && field.optional) continue;
      if (field.type === 'integer') {
        if (!Number.isSafeInteger(value) || value < 1) return null;
      } else if (typeof value !== field.type) return null;
      if (field.enum && !field.enum.includes(value)) return null;
      if (typeof value === 'string') {
        if (!value.trim()) return null;
        action[key] = ['word', 'target', 'newWord'].includes(key)
          ? dictionaryWord(value)
          : value.normalize('NFC').trim();
      } else action[key] = value;
    }
    if (
      action.type === 'update_word' &&
      !action.newWord &&
      !action.translation &&
      !action.partOfSpeech
    )
      return null;
    actions.push(action as DictionaryAction);
  }
  return actions;
}

export function actionWords(actions: DictionaryAction[]): string[] {
  return [
    ...new Set(
      actions
        .flatMap((action) => [
          action.word,
          ...('target' in action ? [action.target] : []),
          ...('newWord' in action && action.newWord ? [action.newWord] : []),
        ])
        .map(dictionaryWord),
    ),
  ];
}

export interface DictionarySnapshot {
  word: string;
  version: string | null;
}
export function dictionarySnapshot(
  word: string,
  row?: Word | null,
): DictionarySnapshot {
  return {
    word: dictionaryWord(word),
    version: row
      ? createHash('sha256')
          .update(
            JSON.stringify([
              row.id,
              row.word,
              row.translation,
              row.senses,
              row.partOfSpeech,
              row.kind,
              row.literalTranslation,
              row.status,
              row.statusReason,
              row.relatedWordId,
              row.comments,
            ]),
          )
          .digest('hex')
      : null,
  };
}

export function inspectDictionaryRecord(word: string, row?: Word | null) {
  let senses;
  let numberingError;
  if (row) {
    try {
      senses = getSenses(row).map((sense, index) => ({
        number: index + 1,
        ...sense,
      }));
    } catch {
      numberingError =
        'Прежняя нумерация неоднозначна; уточни полный перевод перед изменением отдельных значений.';
    }
  }
  return {
    ...dictionarySnapshot(word, row),
    record: row
      ? {
          word: row.word,
          translation: row.translation,
          senses,
          numberingError,
          partOfSpeech: row.partOfSpeech,
          kind: row.kind,
          literalTranslation: row.literalTranslation,
          status: row.status,
          statusReason: row.statusReason,
          relatedWordId: row.relatedWordId,
        }
      : null,
  };
}
