import * as https from 'https';

export const SHEET_ID = '1DRomX8f2oxBIVpvygpySyGQ8UZf1UBXb7B8DYFfZSdg';

export interface SheetDescriptor {
  name: string;
  label: string;
  source: 'etalon' | 'rabochy';
  gid?: string;
}

export const SHEETS: SheetDescriptor[] = [
  { name: 'Эталонный словарь', label: 'Standard Dictionary', source: 'etalon' },
  {
    name: 'Рабочий словарь',
    label: 'Working Dictionary',
    source: 'rabochy',
    gid: '1176528049',
  },
];

const VALID_PARTS_OF_SPEECH = new Set([
  'существительное',
  'существительные',
  'существительно',
  'глагол',
  'прилагательное',
  'прилагательный',
  'прилагательнле',
  'наречие',
  'местоимение',
  'союз',
  'междометие',
  'предлог',
  'частица',
  'числительное',
  'причастие',
  'сущ+глагол',
  'глагол-наречие',
  'фразеологизм',
  'словосочетание',
  'вводное слово',
  'вводное соово',
  'обращение',
  'наречный оборот',
  'предлог + существительное',
]);

export const TSINTSKARO_ALPHABET = [
  'А', 'Â', 'Б', 'В', 'Г', 'Гх', 'Д', 'Дж',
  'Е', 'Ё', 'Ж', 'З', 'И', 'Û', 'Й', 'К',
  'Л', 'М', 'Н', 'О', 'Ô', 'П', 'Р', 'С',
  'Т', 'У', 'Ŷ', 'Ф', 'Х', 'Хг', 'Ц', 'Ч',
  'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
];

const MULTI_CHAR_LETTERS = ['Гх', 'Дж', 'Хг'];

export interface ParsedSheetEntry {
  word: string;
  translation: string;
  partOfSpeech?: string;
  comments?: string;
  source: 'etalon' | 'rabochy';
}

export function buildCSVUrl(sheet: SheetDescriptor): string {
  if (sheet.gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${sheet.gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet.name)}`;
}

export function fetchCSV(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          return fetchCSV(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch: HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

export function parseCSV(csvContent: string): string[][] {
  const rows: string[][] = [];
  const lines = csvContent.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    const row: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    row.push(currentField.trim());
    rows.push(row);
  }
  return rows;
}

function isPartOfSpeech(str: string): boolean {
  if (!str) return false;
  const normalized = str.toLowerCase().trim();
  return (
    VALID_PARTS_OF_SPEECH.has(normalized) ||
    normalized.includes('словосочетание') ||
    normalized.includes('выражение')
  );
}

export function normalizePartOfSpeech(pos: string): string {
  const normalized = pos.toLowerCase();
  const mappings: Record<string, string> = {
    существительное: 'существительное',
    существительные: 'существительное',
    существительно: 'существительное',
    сущ: 'существительное',
    'сущ+глагол': 'сущ+глагол',
    глагол: 'глагол',
    'глагол-наречие': 'глагол-наречие',
    прилагательное: 'прилагательное',
    наречие: 'наречие',
    местоимение: 'местоимение',
    союз: 'союз',
    междометие: 'междометие',
    предлог: 'предлог',
    частица: 'частица',
    числительное: 'числительное',
  };
  return mappings[normalized] ?? pos;
}

export function convertToDictionary(
  rows: string[][],
  source: 'etalon' | 'rabochy',
): ParsedSheetEntry[] {
  const dataRows = rows.slice(1);
  const dictionary: ParsedSheetEntry[] = [];

  for (const row of dataRows) {
    let [word, translation, partOfSpeech, comments] = row;

    if (!word || !translation) continue;

    if (isPartOfSpeech(translation) && partOfSpeech && !isPartOfSpeech(partOfSpeech)) {
      [translation, partOfSpeech] = [partOfSpeech, translation];
    }

    const entry: ParsedSheetEntry = {
      word: word.trim(),
      translation: translation.trim(),
      source,
    };
    if (partOfSpeech?.trim()) entry.partOfSpeech = normalizePartOfSpeech(partOfSpeech.trim());
    if (comments?.trim()) entry.comments = comments.trim();
    dictionary.push(entry);
  }
  return dictionary;
}

const LETTER_ORDER = new Map<string, number>();
TSINTSKARO_ALPHABET.forEach((letter, index) => LETTER_ORDER.set(letter.toUpperCase(), index));

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
    const orderA = LETTER_ORDER.has(tokensA[i]) ? LETTER_ORDER.get(tokensA[i])! : 999;
    const orderB = LETTER_ORDER.has(tokensB[i]) ? LETTER_ORDER.get(tokensB[i])! : 999;
    if (orderA !== orderB) return orderA - orderB;
  }
  return tokensA.length - tokensB.length;
}

export function mergeSheetEntries(
  sheetsEntries: ParsedSheetEntry[][],
): ParsedSheetEntry[] {
  const seen = new Set<string>();
  const merged: ParsedSheetEntry[] = [];

  for (const entries of sheetsEntries) {
    for (const entry of entries) {
      const key = entry.word.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

export async function fetchAllSheetsEntries(): Promise<ParsedSheetEntry[]> {
  const csvResults = await Promise.all(
    SHEETS.map(async (sheet) => {
      const url = buildCSVUrl(sheet);
      const csv = await fetchCSV(url);
      return { sheet, csv };
    }),
  );

  const sheetsEntries: ParsedSheetEntry[][] = [];
  for (const { sheet, csv } of csvResults) {
    const rows = parseCSV(csv);
    sheetsEntries.push(convertToDictionary(rows, sheet.source));
  }

  const merged = mergeSheetEntries(sheetsEntries);
  return merged.sort((a, b) => compareTsintskaroWords(a.word, b.word));
}
