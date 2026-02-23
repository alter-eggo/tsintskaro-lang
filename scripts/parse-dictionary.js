#!/usr/bin/env node

/**
 * Standalone script to fetch the Tsintskaro dictionary from Google Sheets and write
 * src/assets/dictionary.json. Can be run manually or via cron.
 *
 * Usage: node scripts/parse-dictionary.js
 *
 * The Google Sheet must be published to the web as CSV.
 * Go to: File > Share > Publish to web > Select "Comma-separated values (.csv)"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SHEET_ID = '1DRomX8f2oxBIVpvygpySyGQ8UZf1UBXb7B8DYFfZSdg';
const SHEETS = [
  { name: 'Эталонный словарь', label: 'Standard Dictionary' },
  { name: 'Рабочий словарь', label: 'Working Dictionary', gid: '1176528049' },
];
const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'assets', 'dictionary.json');

function buildCSVUrl(sheet) {
  if (sheet.gid) {
    return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${sheet.gid}`;
  }
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet.name)}`;
}

function fetchCSV(url) {
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

function parseCSV(csvContent) {
  const rows = [];
  const lines = csvContent.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
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

const VALID_PARTS_OF_SPEECH = new Set([
  'существительное', 'существительные', 'существительно', 'глагол',
  'прилагательное', 'прилагательный', 'прилагательнле', 'наречие',
  'местоимение', 'союз', 'междометие', 'предлог', 'частица', 'числительное',
  'причастие', 'сущ+глагол', 'глагол-наречие', 'фразеологизм', 'словосочетание',
  'вводное слово', 'вводное соово', 'обращение', 'наречный оборот',
  'предлог + существительное',
]);

function isPartOfSpeech(str) {
  if (!str) return false;
  const n = str.toLowerCase().trim();
  return VALID_PARTS_OF_SPEECH.has(n) || n.includes('словосочетание') || n.includes('выражение');
}

function normalizePartOfSpeech(pos) {
  const m = {
    существительное: 'существительное', существительные: 'существительное',
    существительно: 'существительное', сущ: 'существительное', 'сущ+глагол': 'сущ+глагол',
    глагол: 'глагол', 'глагол-наречие': 'глагол-наречие', прилагательное: 'прилагательное',
    наречие: 'наречие', местоимение: 'местоимение', союз: 'союз', междометие: 'междометие',
    предлог: 'предлог', частица: 'частица', числительное: 'числительное',
  };
  return m[pos.toLowerCase()] ?? pos;
}

function convertToDictionary(rows) {
  const dataRows = rows.slice(1);
  const dictionary = [];
  for (const row of dataRows) {
    let [word, translation, partOfSpeech, comments] = row;
    if (!word || !translation) continue;
    if (isPartOfSpeech(translation) && partOfSpeech && !isPartOfSpeech(partOfSpeech)) {
      [translation, partOfSpeech] = [partOfSpeech, translation];
    }
    const entry = { word: word.trim(), translation: translation.trim() };
    if (partOfSpeech?.trim()) entry.partOfSpeech = normalizePartOfSpeech(partOfSpeech.trim());
    if (comments?.trim()) entry.comments = comments.trim();
    dictionary.push(entry);
  }
  return dictionary;
}

const TSINTSKARO_ALPHABET = [
  'А', 'Â', 'Б', 'В', 'Г', 'Гх', 'Д', 'Дж', 'Е', 'Ё', 'Ж', 'З', 'И', 'Û', 'Й', 'К',
  'Л', 'М', 'Н', 'О', 'Ô', 'П', 'Р', 'С', 'Т', 'У', 'Ŷ', 'Ф', 'Х', 'Хг', 'Ц', 'Ч',
  'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
];
const MULTI_CHAR_LETTERS = ['Гх', 'Дж', 'Хг'];
const LETTER_ORDER = new Map();
TSINTSKARO_ALPHABET.forEach((l, i) => LETTER_ORDER.set(l.toUpperCase(), i));

function tokenizeWord(word) {
  const upper = word.toUpperCase();
  const tokens = [];
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
    if (!matched) { tokens.push(upper[i]); i++; }
  }
  return tokens;
}

function compareTsintskaroWords(a, b) {
  const ta = tokenizeWord(a);
  const tb = tokenizeWord(b);
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const oa = LETTER_ORDER.has(ta[i]) ? LETTER_ORDER.get(ta[i]) : 999;
    const ob = LETTER_ORDER.has(tb[i]) ? LETTER_ORDER.get(tb[i]) : 999;
    if (oa !== ob) return oa - ob;
  }
  return ta.length - tb.length;
}

function mergeSheetEntries(sheetsEntries) {
  const primaryWords = new Set();
  const merged = [];
  for (let i = 0; i < sheetsEntries.length; i++) {
    const entries = sheetsEntries[i];
    if (i === 0) {
      for (const e of entries) {
        primaryWords.add(e.word.toLowerCase().trim());
        merged.push(e);
      }
    } else {
      for (const e of entries) {
        const k = e.word.toLowerCase().trim();
        if (!primaryWords.has(k)) merged.push(e);
      }
    }
  }
  return merged;
}

async function main() {
  console.log('Fetching dictionary from Google Sheets...');
  try {
    const csvResults = await Promise.all(
      SHEETS.map(async (sheet) => {
        const url = buildCSVUrl(sheet);
        const csv = await fetchCSV(url);
        return { sheet, csv };
      }),
    );
    const sheetsEntries = csvResults.map(({ sheet, csv }) => {
      const rows = parseCSV(csv);
      return convertToDictionary(rows);
    });
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

    const dir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`✓ Dictionary saved to ${OUTPUT_PATH} (${dictionary.length} entries)`);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
