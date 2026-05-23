import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Word } from './entities/word.entity';
import { compareTsintskaroWords } from './sheets-parser';

export interface DictionaryEntry {
  word: string;
  translation: string;
  partOfSpeech?: string;
}

export interface UpsertWordInput {
  word: string;
  translation: string;
  partOfSpeech?: string | null;
  addedBy?: string | null;
}

export interface DictionaryLeaderboardEntry {
  username: string;
  wordsCount: number;
}

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  private cache: DictionaryEntry[] | null = null;
  private cacheById: Map<string, DictionaryEntry> | null = null;

  constructor(
    @InjectRepository(Word)
    private readonly wordRepo: Repository<Word>,
  ) {}

  private invalidateCache() {
    this.cache = null;
    this.cacheById = null;
  }

  reload() {
    this.invalidateCache();
  }

  private async ensureCache(): Promise<void> {
    if (this.cache && this.cacheById) return;
    const rows = await this.wordRepo.find();
    const entries: DictionaryEntry[] = rows.map((r) => ({
      word: r.word,
      translation: r.translation,
      partOfSpeech: r.partOfSpeech ?? undefined,
    }));
    entries.sort((a, b) => compareTsintskaroWords(a.word, b.word));
    this.cache = entries;
    this.cacheById = new Map(entries.map((e) => [e.word, e]));
    this.logger.log(`Loaded ${entries.length} dictionary entries from DB`);
  }

  async getEntries(): Promise<DictionaryEntry[]> {
    await this.ensureCache();
    return this.cache!;
  }

  async getFormattedForPrompt(): Promise<string> {
    await this.ensureCache();
    if (this.cache!.length === 0) return '';
    return this.cache!.map((e) => `${e.word} = ${e.translation}`).join('\n');
  }

  async findWord(word: string): Promise<DictionaryEntry | undefined> {
    await this.ensureCache();
    return this.cacheById!.get(word.toLowerCase().trim());
  }

  async deleteWords(
    words: string[],
  ): Promise<{ deleted: string[]; notFound: string[] }> {
    const normalized = Array.from(
      new Set(
        words.map((w) => w.toLowerCase().trim()).filter((w) => w.length > 0),
      ),
    );
    if (normalized.length === 0) {
      return { deleted: [], notFound: [] };
    }

    const existing = await this.wordRepo.find({
      where: { word: In(normalized) },
      select: { word: true },
    });
    const existingSet = new Set(existing.map((e) => e.word));

    const deleted = normalized.filter((w) => existingSet.has(w));
    const notFound = normalized.filter((w) => !existingSet.has(w));

    if (deleted.length > 0) {
      await this.wordRepo.delete({ word: In(deleted) });
      this.invalidateCache();
    }

    return { deleted, notFound };
  }

  async upsertWord(
    input: UpsertWordInput,
  ): Promise<{ created: boolean; word: Word }> {
    const normalizedWord = input.word.toLowerCase().trim();
    const existing = await this.wordRepo.findOne({
      where: { word: normalizedWord },
    });

    if (existing) {
      existing.translation = input.translation;
      if (input.partOfSpeech !== undefined) {
        existing.partOfSpeech = input.partOfSpeech;
      }
      if (input.addedBy !== undefined && !existing.addedBy) {
        existing.addedBy = input.addedBy;
      }
      existing.source = 'chat';
      const saved = await this.wordRepo.save(existing);
      this.invalidateCache();
      return { created: false, word: saved };
    }

    const created = this.wordRepo.create({
      word: normalizedWord,
      translation: input.translation,
      partOfSpeech: input.partOfSpeech ?? null,
      comments: null,
      source: 'chat',
      addedBy: input.addedBy ?? null,
    });
    const saved = await this.wordRepo.save(created);
    this.invalidateCache();
    return { created: true, word: saved };
  }

  async getLeaderboard(limit = 10): Promise<DictionaryLeaderboardEntry[]> {
    const rows = await this.wordRepo
      .createQueryBuilder('word')
      .select('word.addedBy', 'username')
      .addSelect('COUNT(word.id)', 'words_count')
      .where('word.addedBy IS NOT NULL')
      .andWhere("word.addedBy <> ''")
      .andWhere('word.source = :source', { source: 'chat' })
      .groupBy('word.addedBy')
      .orderBy('COUNT(word.id)', 'DESC')
      .addOrderBy('word.addedBy', 'ASC')
      .limit(limit)
      .getRawMany<{ username: string; words_count: string }>();

    return rows.map((row) => ({
      username: row.username,
      wordsCount: Number(row.words_count),
    }));
  }
}
