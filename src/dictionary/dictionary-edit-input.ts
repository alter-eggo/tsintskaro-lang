import type { WordKind } from './dictionary-content';

export type DictionaryEdit =
  | {
      type: 'move_example';
      word: string;
      target: string;
      sense: number;
      createSense?: boolean;
      translation?: string;
      phrase?: string;
    }
  | {
      type: 'add_example';
      word: string;
      sense: number;
      phrase: string;
      translation: string;
    }
  | {
      type: 'set_sense';
      word: string;
      sense: number;
      translation: string;
      createSense?: boolean;
    }
  | { type: 'set_sense_pos'; word: string; sense: number; partOfSpeech: string }
  | {
      type: 'set_example';
      word: string;
      sense: number;
      phrase: string;
      translation: string;
    }
  | {
      type: 'set_kind';
      word: string;
      kind: WordKind;
      literalTranslation?: string;
    }
  | {
      type: 'set_status';
      word: string;
      status: 'active' | 'deferred';
      reason?: string;
    };

export const DICTIONARY_EDIT_HELP =
  'Укажи слова в кавычках и номер значения. Например: «Баласи, перенеси «авара дурмах» в запись слова «авара» как пример к значению 1». Для исправления: «Баласи, измени значение 3 слова «аваралых» на «ерунда»».';

const Q = '[«"“]([^»"”]+)[»"”]';
const END = '[.!\\s]*$';

/** Explicit commands only. An unparsed editing request must never become add_words. */
export function parseDictionaryEdit(
  input: string,
): DictionaryEdit | 'invalid' | null {
  const text = input
    .normalize('NFC')
    .replace(/^\s*(?:бот|баласи)[\s,:!.—-]+/i, '')
    .trim();
  let m: RegExpMatchArray | null;
  // The familiar "add translation variant" wording may specify a numbered
  // meaning. Keep its number out of the legacy, unstructured translation merge.
  const variant = text.match(
    /^добавь\s+(?:новый\s+)?вариант\s+перевода\s*:\s*([\s\S]+)$/i,
  );
  if (variant) {
    m = variant[1].match(
      new RegExp(
        `^(?:${Q}|([^«»"“”\\n]+?))\\s*[-—–:]\\s*(\\d+)[).]\\s+([^\\n]+?)${END}`,
        'i',
      ),
    );
    if (m) {
      const word = (m[1] ?? m[2]).trim();
      const translation = m[4]
        .trim()
        .replace(/[.!]+$/, '')
        .trim();
      if (!word || !translation || /(?:^|[;\s])\d+[).]\s/.test(translation))
        return 'invalid';
      return {
        type: 'set_sense',
        word,
        sense: Number(m[3]),
        translation,
        createSense: true,
      };
    }
    // An incomplete or multi-meaning numbered request must not fall through to AI.
    if (/\d+[).]/.test(variant[1])) return 'invalid';
  }
  m = text.match(
    new RegExp(
      `^перенеси\\s+${Q}\\s+в\\s+(?:запись(?:\\s+слова)?|слово|статью)\\s+${Q}\\s+как\\s+пример\\s+к\\s+(новому\\s+)?значению\\s+(\\d+)([\\s\\S]*)$`,
      'i',
    ),
  );
  if (m) {
    let tail = m[5];
    const translation = tail.match(
      new RegExp(`перевод\\s+примера\\s*[-—:=]\\s*${Q}`, 'i'),
    );
    const phrase = tail.match(
      new RegExp(`написание\\s+примера\\s*[-—:=]\\s*${Q}`, 'i'),
    );
    const blank = /(?:само\s+)?значение\s+пока\s+оставь\s+пустым/i;
    const createSense = !!m[3] && blank.test(tail);
    tail = tail
      .replace(translation?.[0] ?? /$^/, '')
      .replace(phrase?.[0] ?? /$^/, '')
      .replace(blank, '');
    if (!/^[.;\s]*$/.test(tail) || (!!m[3] && !createSense)) return 'invalid';
    return {
      type: 'move_example',
      word: m[1],
      target: m[2],
      sense: Number(m[4]),
      createSense,
      ...(translation ? { translation: translation[1] } : {}),
      ...(phrase ? { phrase: phrase[1] } : {}),
    };
  }
  m = text.match(
    new RegExp(
      `^(измени|замени|добавь)\\s+значение\\s+(\\d+)\\s+(?:слова|в\\s+записи(?:\\s+слова)?)\\s+${Q}\\s+(?:на|[-—:=])\\s*${Q}${END}`,
      'i',
    ),
  );
  if (m)
    return {
      type: 'set_sense',
      word: m[3],
      sense: Number(m[2]),
      translation: m[4],
      createSense: m[1].toLowerCase() === 'добавь',
    };
  m = text.match(
    new RegExp(
      `^укажи\\s+для\\s+значения\\s+(\\d+)\\s+слова\\s+${Q}\\s+часть\\s+речи\\s+${Q}${END}`,
      'i',
    ),
  );
  if (m)
    return {
      type: 'set_sense_pos',
      word: m[2],
      sense: Number(m[1]),
      partOfSpeech: m[3],
    };
  m = text.match(
    new RegExp(
      `^добавь\\s+к\\s+значению\\s+(\\d+)\\s+слова\\s+${Q}\\s+пример\\s+${Q}\\s*[-—]\\s*${Q}${END}`,
      'i',
    ),
  );
  if (m)
    return {
      type: 'add_example',
      word: m[2],
      sense: Number(m[1]),
      phrase: m[3],
      translation: m[4],
    };
  m = text.match(
    new RegExp(
      `^(?:измени|замени)\\s+перевод\\s+примера\\s+${Q}\\s+(?:у\\s+слова|в\\s+записи(?:\\s+слова)?)\\s+${Q}\\s+(?:в\\s+значении|для\\s+значения)\\s+(\\d+)\\s+на\\s+${Q}${END}`,
      'i',
    ),
  );
  if (m)
    return {
      type: 'set_example',
      word: m[2],
      sense: Number(m[3]),
      phrase: m[1],
      translation: m[4],
    };
  m = text.match(
    new RegExp(
      `^укажи\\s+тип\\s+записи\\s+${Q}\\s*[-—:=]\\s*(слово|фразеологизм|пословица(?:/поговорка)?|поговорка)([\\s\\S]*)$`,
      'i',
    ),
  );
  if (m) {
    const literal = m[3].match(
      new RegExp(`^[.;\\s]*буквально\\s*[-—:=]\\s*${Q}${END}`, 'i'),
    );
    if (!literal && !/^[.\s]*$/.test(m[3])) return 'invalid';
    return {
      type: 'set_kind',
      word: m[1],
      kind:
        m[2].toLowerCase() === 'слово'
          ? 'word'
          : m[2].toLowerCase() === 'фразеологизм'
            ? 'idiom'
            : 'proverb',
      ...(literal ? { literalTranslation: literal[1] } : {}),
    };
  }
  m = text.match(
    new RegExp(
      `^(отложи|верни)\\s+(?:запись(?:\\s+слова)?|слово)\\s+${Q}(?:\\s+в\\s+словарь)?(?:\\s*[-—:]\\s*([^\\n]+?))?${END}`,
      'i',
    ),
  );
  if (m)
    return {
      type: 'set_status',
      word: m[2],
      status: m[1].toLowerCase() === 'отложи' ? 'deferred' : 'active',
      ...(m[3] ? { reason: m[3].trim() } : {}),
    };
  return /^(?:перенеси(?=\s|$)|отложи\s+(?:запись|слово)|верни\s+(?:запись|слово)|(?:измени|замени|добавь)\s+(?:значение(?=\s|$)|перевод\s+примера(?=\s|$))|добавь\s+(?:пример(?=\s|$)|к\s+значению(?=\s|$))|укажи\s+(?:тип\s+записи|для\s+значения))/iu.test(
    text,
  ) ||
    (/^(?:исправь|измени|добавь|примени)(?=\s|:)/iu.test(text) &&
      /(?:перенести\s+как\s+пример|как\s+пример\s+слова|исключить\s+до\s+решения|пословица\/поговорка|тип\s+записи)/iu.test(
        text,
      ))
    ? 'invalid'
    : null;
}
