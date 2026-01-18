import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

export interface DictionaryEntry {
  word: string;
  translation: string;
}

@Injectable()
export class DictionaryService implements OnModuleInit {
  private readonly logger = new Logger(DictionaryService.name);
  private entries: DictionaryEntry[] = [];

  onModuleInit() {
    this.loadDictionary();
  }

  private loadDictionary() {
    // Try multiple possible paths
    const possiblePaths = [
      path.join(__dirname, '..', 'assets', 'disctionary.xlsx'),
      path.join(process.cwd(), 'src', 'assets', 'disctionary.xlsx'),
      path.join(process.cwd(), 'dist', 'assets', 'disctionary.xlsx'),
    ];

    let filePath: string | null = null;
    for (const p of possiblePaths) {
      try {
        fs.accessSync(p);
        filePath = p;
        this.logger.log(`Found dictionary at: ${p}`);
        break;
      } catch {
        // File not found at this path, try next
      }
    }

    if (!filePath) {
      this.logger.error(`Dictionary not found. Tried: ${possiblePaths.join(', ')}`);
      return;
    }

    try {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Convert to JSON, assuming first row might be headers
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
      
      // Skip header row if it looks like headers
      const startRow = this.looksLikeHeader(rows[0]) ? 1 : 0;
      
      for (let i = startRow; i < rows.length; i++) {
        const row = rows[i];
        if (row && row[0] && row[1]) {
          this.entries.push({
            word: String(row[0]).trim().toLowerCase(),
            translation: String(row[1]).trim(),
          });
        }
      }
      
      this.logger.log(`Loaded ${this.entries.length} dictionary entries`);
      
      // Log first few entries as sample
      if (this.entries.length > 0) {
        const sample = this.entries.slice(0, 3).map(e => `${e.word}=${e.translation}`).join(', ');
        this.logger.log(`Sample entries: ${sample}`);
      }
    } catch (error) {
      this.logger.error('Failed to load dictionary:', error);
    }
  }

  private looksLikeHeader(row: string[]): boolean {
    if (!row || !row[0]) return false;
    const firstCell = String(row[0]).toLowerCase();
    return ['word', 'слово', 'söz', 'სიტყვა'].some(h => firstCell.includes(h));
  }

  getEntries(): DictionaryEntry[] {
    return this.entries;
  }

  getFormattedForPrompt(): string {
    if (this.entries.length === 0) return '';
    
    return this.entries
      .map(e => `${e.word} = ${e.translation}`)
      .join('\n');
  }

  findWord(word: string): DictionaryEntry | undefined {
    return this.entries.find(e => e.word === word.toLowerCase().trim());
  }
}
