export interface WordExample {
  phrase: string;
  translation: string;
  sourceWordId?: number;
  aliases?: string[];
}

export interface WordSense {
  translation: string | null;
  partOfSpeech?: string | null;
  examples: WordExample[];
}

export type WordKind = 'word' | 'idiom' | 'proverb';
export type WordStatus =
  | 'active'
  | 'deferred'
  | 'embedded'
  | 'merged'
  | 'deleted';

export const WORD_KIND_LABELS: Record<WordKind, string> = {
  word: 'слово',
  idiom: 'фразеологизм',
  proverb: 'пословица/поговорка',
};

export class DictionaryContentError extends Error {}

export function normalizeDictionaryText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function sameText(a: string, b: string): boolean {
  return (
    normalizeDictionaryText(a).toLowerCase() ===
    normalizeDictionaryText(b).toLowerCase()
  );
}

/** Only explicit, consecutive numbering denotes senses; commas remain synonyms. */
export function parseLegacySenses(translation: string): WordSense[] {
  const text = translation.trim();
  const markers = [...text.matchAll(/(?:^|[;\n]\s*|\s+)(\d+)[).]\s+/g)];
  if (!/^\d+[).]\s/.test(text))
    return [{ translation: text || null, examples: [] }];
  if (markers.some((m, i) => Number(m[1]) !== i + 1)) {
    throw new DictionaryContentError(
      'Нумерация значений неоднозначна. Сначала уточни полный перевод с последовательными номерами 1), 2), 3).',
    );
  }
  return markers.map((m, i) => ({
    translation:
      text
        .slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length)
        .replace(/[;\s]+$/, '')
        .trim() || null,
    examples: [],
  }));
}

export function getSenses(word: {
  translation: string;
  senses?: WordSense[] | null;
}): WordSense[] {
  return structuredClone(
    word.senses?.length ? word.senses : parseLegacySenses(word.translation),
  );
}

export function renderSenses(senses: WordSense[], separator = '; '): string {
  return senses
    .map((sense, i) => {
      const gloss = [
        sense.translation,
        sense.partOfSpeech ? `(${sense.partOfSpeech})` : null,
      ]
        .filter(Boolean)
        .join(' ');
      const pieces = [
        gloss,
        ...sense.examples.map((e) => `${e.phrase} — ${e.translation}`),
      ].filter(Boolean);
      return `${senses.length > 1 ? `${i + 1}) ` : ''}${pieces.join('; ')}`;
    })
    .join(separator);
}

/** Merge without dropping either spelling's meanings or examples. */
export function mergeSenses(
  target: WordSense[],
  incoming: WordSense[],
): WordSense[] {
  const result = structuredClone(target);
  for (const sense of incoming) {
    const existing = result.find(
      (s) =>
        sameText(s.translation ?? '', sense.translation ?? '') &&
        (s.partOfSpeech ?? null) === (sense.partOfSpeech ?? null),
    );
    if (!existing) {
      result.push(structuredClone(sense));
      continue;
    }
    for (const example of sense.examples) {
      if (
        !existing.examples.some(
          (e) =>
            sameText(e.phrase, example.phrase) &&
            sameText(e.translation, example.translation),
        )
      ) {
        existing.examples.push(structuredClone(example));
      }
    }
  }
  return result;
}

export function assertEditableWord(word: {
  status?: WordStatus;
  relatedWordId?: number | null;
}): void {
  if (word.status === 'deleted')
    throw new DictionaryContentError(
      'Эта запись удалена. Сначала верни её в словарь отдельной командой.',
    );
  if (word.status === 'embedded' || word.status === 'merged') {
    throw new DictionaryContentError(
      'Эта запись уже перенесена. Изменяй значение или пример в основной записи.',
    );
  }
}
