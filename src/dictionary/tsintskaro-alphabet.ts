export const TSINTSKARO_ALPHABET = [
  'А',
  'Â',
  'Б',
  'В',
  'Г',
  'Гх',
  'Д',
  'Дж',
  'Е',
  'Ё',
  'Ж',
  'З',
  'И',
  'Û',
  'Й',
  'К',
  'Л',
  'М',
  'Н',
  'О',
  'Ô',
  'П',
  'Р',
  'С',
  'Т',
  'У',
  'Ŷ',
  'Ф',
  'Х',
  'Хг',
  'Ц',
  'Ч',
  'Ш',
  'Щ',
  'Ъ',
  'Ы',
  'Ь',
  'Э',
  'Ю',
  'Я',
];

const MULTI_CHAR_LETTERS = ['Гх', 'Дж', 'Хг'];

const LETTER_ORDER = new Map<string, number>();
TSINTSKARO_ALPHABET.forEach((letter, index) =>
  LETTER_ORDER.set(letter.toUpperCase(), index),
);

function tokenizeWord(word: string): string[] {
  const upper = word.toUpperCase();
  const tokens: string[] = [];
  let i = 0;
  while (i < upper.length) {
    let matched = false;
    for (const ml of MULTI_CHAR_LETTERS) {
      if (upper.startsWith(ml.toUpperCase(), i)) {
        tokens.push(ml.toUpperCase());
        i += ml.length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push(upper[i]);
      i++;
    }
  }
  return tokens;
}

export function compareTsintskaroWords(a: string, b: string): number {
  const tokensA = tokenizeWord(a);
  const tokensB = tokenizeWord(b);
  const len = Math.min(tokensA.length, tokensB.length);
  for (let i = 0; i < len; i++) {
    const orderA = LETTER_ORDER.has(tokensA[i])
      ? LETTER_ORDER.get(tokensA[i])!
      : 999;
    const orderB = LETTER_ORDER.has(tokensB[i])
      ? LETTER_ORDER.get(tokensB[i])!
      : 999;
    if (orderA !== orderB) return orderA - orderB;
  }
  return tokensA.length - tokensB.length;
}
