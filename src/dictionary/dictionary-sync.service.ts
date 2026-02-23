import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import { DictionaryService } from './dictionary.service';

const SHEET_ID = '1DRomX8f2oxBIVpvygpySyGQ8UZf1UBXb7B8DYFfZSdg';

const SHEETS = [
  { name: 'Эталонный словарь', label: 'Standard Dictionary' },
  { name: 'Рабочий словарь', label: 'Working Dictionary', gid: '1176528049' },
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

const TSINTSKARO_ALPHABET = [
  'А', 'Â', 'Б', 'В', 'Г', 'Гх', 'Д', 'Дж',
  'Е', 'Ё', 'Ж', 'З', 'И', 'Û', 'Й', 'К',
  'Л', 'М', 'Н', 'О', 'Ô', 'П', 'Р', 'С',
  'Т', 'У', 'Ŷ', 'Ф', 'Х', 'Хг', 'Ц', 'Ч',
  'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
];

const MULTI_CHAR_LETTERS = ['Гх', 'Дж', 'Хг'];

function buildCSVUrl(sheet: (typeof SHEETS)[0]): string {
  if (sheet.gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${sheet.gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet.name)}`;
}

function fetchCSV(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchCSV(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Failed to fetch: HTTP ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

function parseCSV(csvContent: string): string[][] {
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

function normalizePartOfSpeech(pos: string): string {
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

interface DictEntry {
  word: string;
  translation: string;
  partOfSpeech?: string;
  comments?: string;
}

function convertToDictionary(rows: string[][]): DictEntry[] {
  const dataRows = rows.slice(1);
  const dictionary: DictEntry[] = [];

  for (const row of dataRows) {
    let [word, translation, partOfSpeech, comments] = row;

    if (!word || !translation) continue;

    if (isPartOfSpeech(translation) && partOfSpeech && !isPartOfSpeech(partOfSpeech)) {
      [translation, partOfSpeech] = [partOfSpeech, translation];
    }

    const entry: DictEntry = { word: word.trim(), translation: translation.trim() };
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

function compareTsintskaroWords(a: string, b: string): number {
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

function mergeSheetEntries(sheetsEntries: DictEntry[][]): DictEntry[] {
  const primaryWords = new Set<string>();
  const merged: DictEntry[] = [];

  for (let i = 0; i < sheetsEntries.length; i++) {
    const entries = sheetsEntries[i];
    if (i === 0) {
      for (const entry of entries) {
        primaryWords.add(entry.word.toLowerCase().trim());
        merged.push(entry);
      }
    } else {
      for (const entry of entries) {
        const key = entry.word.toLowerCase().trim();
        if (!primaryWords.has(key)) merged.push(entry);
      }
    }
  }
  return merged;
}

@Injectable()
export class DictionarySyncService {
  private readonly logger = new Logger(DictionarySyncService.name);

  constructor(private readonly dictionaryService: DictionaryService) {}

  @Cron('0 3 * * *')
  async handleDailySync() {
    this.logger.log('Running daily dictionary sync from Google Sheets');
    await this.syncFromGoogleSheets();
  }

  async syncFromGoogleSheets(): Promise<void> {
    try {
      const csvResults = await Promise.all(
        SHEETS.map(async (sheet) => {
          const url = buildCSVUrl(sheet);
          this.logger.debug(`Fetching "${sheet.name}"...`);
          const csv = await fetchCSV(url);
          return { sheet, csv };
        }),
      );

      const sheetsEntries: DictEntry[][] = [];
      for (const { sheet, csv } of csvResults) {
        const rows = parseCSV(csv);
        const entries = convertToDictionary(rows);
        sheetsEntries.push(entries);
      }

      const merged = mergeSheetEntries(sheetsEntries);
      const dictionary = merged.sort((a, b) => compareTsintskaroWords(a.word, b.word));

      const output = {
        metadata: {
          name: 'Словарь цинцкарского языка',
          nameEn: 'Dictionary of Tsintskaro Language',
          source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
          sheets: SHEETS.map((s) => s.name),
          lastUpdated: new Date().toISOString(),
          totalEntries: dictionary.length,
        },
        entries: dictionary,
      };

      const possiblePaths = [
        path.join(process.cwd(), 'src', 'assets', 'dictionary.json'),
        path.join(process.cwd(), 'dist', 'assets', 'dictionary.json'),
      ];

      for (const outputPath of possiblePaths) {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
        this.logger.log(`Wrote dictionary to ${outputPath} (${dictionary.length} entries)`);
      }

      this.dictionaryService.reload();
      this.logger.log('Dictionary sync completed successfully');
    } catch (error) {
      this.logger.error('Dictionary sync failed', error);
    }
  }
}
