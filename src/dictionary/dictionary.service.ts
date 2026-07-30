import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Word, type WordSource } from './entities/word.entity';
import { compareTsintskaroWords } from './sheets-parser';

export interface DictionaryEntry {
  word: string;
  translation: string;
  partOfSpeech?: string;
  comments?: string;
  source?: WordSource;
}

export interface UpsertWordInput {
  word: string;
  translation: string;
  partOfSpeech?: string | null;
  addedBy?: string | null;
}

export interface UpsertWordResult {
  created: boolean;
  word: Word;
  translationAdded: boolean;
  addedTranslation?: string;
}

export interface UpdateWordInput {
  oldWord: string;
  newWord?: string | null;
  translation?: string | null;
  partOfSpeech?: string | null;
  updatedBy?: string | null;
}

export interface DictionaryLeaderboardEntry {
  username: string;
  wordsCount: number;
}

export interface UpdateWordResult {
  status: 'updated' | 'merged' | 'not_found' | 'ambiguous' | 'empty';
  requestedOldWord: string;
  resolvedOldWord?: string;
  word?: Word;
  candidates?: string[];
}

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  private cache: DictionaryEntry[] | null = null;
  private cacheById: Map<string, DictionaryEntry> | null = null;
  private cacheByFolded: Map<string, DictionaryEntry[]> | null = null;
  private maxDictionaryPhraseWords = 1;

  constructor(
    @InjectRepository(Word)
    private readonly wordRepo: Repository<Word>,
  ) {}

  private invalidateCache() {
    this.cache = null;
    this.cacheById = null;
    this.cacheByFolded = null;
    this.maxDictionaryPhraseWords = 1;
  }

  private normalizeWordInput(word: string): string {
    return word
      .toLowerCase()
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  private foldWordForLookup(word: string): string {
    return this.normalizeWordInput(word)
      .replace(/[aâãáàäā]/gi, 'а')
      .replace(/[c]/gi, 'с')
      .replace(/[eëéèē]/gi, 'е')
      .replace(/[oôóòöō]/gi, 'о')
      .replace(/[p]/gi, 'р')
      .replace(/[x]/gi, 'х')
      .replace(/[yŷûúùüū]/gi, 'у')
      .replace(/ё/g, 'е')
      .replace(/[^0-9а-я]+/gi, '');
  }

  /**
   * Upserts may tolerate keyboard lookalikes, but must not use the broader
   * lookup folding above: folding diacritics and removing spaces can collapse
   * genuinely different dictionary headwords into one record.
   */
  private normalizeWordForUpsertMatch(word: string): string {
    return this.normalizeWordInput(word)
      .replace(/a/g, 'а')
      .replace(/c/g, 'с')
      .replace(/e/g, 'е')
      .replace(/o/g, 'о')
      .replace(/p/g, 'р')
      .replace(/x/g, 'х')
      .replace(/y/g, 'у');
  }

  private normalizeTranslationForCompare(translation: string): string {
    return translation
      .toLowerCase()
      .trim()
      .replace(/[ё]/g, 'е')
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}]+$/g, '');
  }

  private mergeTranslations(
    existing: string,
    incoming: string,
  ): { merged: string; added?: string } {
    const current = existing.trim();
    const next = incoming.trim();
    if (!current) return next ? { merged: next, added: next } : { merged: '' };
    if (!next) return { merged: current };

    const currentNormalized = this.normalizeTranslationForCompare(current);
    const nextNormalized = this.normalizeTranslationForCompare(next);
    if (currentNormalized === nextNormalized) {
      return { merged: current };
    }

    const existingParts = new Set(
      this.splitTranslationParts(current).map(({ normalized }) => normalized),
    );
    const missingParts: string[] = [];
    const incomingParts = new Set<string>();

    for (const part of this.splitTranslationParts(next)) {
      if (existingParts.has(part.normalized)) continue;
      if (incomingParts.has(part.normalized)) continue;
      incomingParts.add(part.normalized);
      missingParts.push(part.value);
    }

    if (missingParts.length === 0) {
      return { merged: current };
    }

    const added = missingParts.join('; ');
    return { merged: `${added}; ${current}`, added };
  }

  private splitTranslationParts(
    translation: string,
  ): Array<{ value: string; normalized: string }> {
    return translation
      .split(/\s*(?:;|,|\n|\/)\s*/g)
      .map((value) => ({
        value: value.trim(),
        normalized: this.normalizeTranslationForCompare(value),
      }))
      .filter(
        ({ value, normalized }) => value.length > 0 && normalized.length > 0,
      );
  }

  private async resolveWordEntity(
    word: string,
  ): Promise<{ entity: Word | null; candidates: Word[] }> {
    const normalized = this.normalizeWordInput(word);
    if (!normalized) {
      return { entity: null, candidates: [] };
    }

    const exact = await this.wordRepo.findOne({ where: { word: normalized } });
    if (exact) {
      return { entity: exact, candidates: [exact] };
    }

    const folded = this.foldWordForLookup(normalized);
    if (!folded) {
      return { entity: null, candidates: [] };
    }

    const rows = await this.wordRepo.find();
    const candidates = rows.filter(
      (row) => this.foldWordForLookup(row.word) === folded,
    );

    if (candidates.length === 1) {
      return { entity: candidates[0], candidates };
    }

    return { entity: null, candidates };
  }

  private async resolveWordEntityForUpsert(word: string): Promise<Word | null> {
    const normalized = this.normalizeWordInput(word);
    if (!normalized) return null;

    const exact = await this.wordRepo.findOne({ where: { word: normalized } });
    if (exact) return exact;

    const safeMatch = this.normalizeWordForUpsertMatch(normalized);
    const rows = await this.wordRepo.find();
    const candidates = rows.filter(
      (row) => this.normalizeWordForUpsertMatch(row.word) === safeMatch,
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  reload() {
    this.invalidateCache();
  }

  private async ensureCache(): Promise<void> {
    if (this.cache && this.cacheById && this.cacheByFolded) return;
    const rows = await this.wordRepo.find();
    const entries: DictionaryEntry[] = rows.map((r) => ({
      word: r.word,
      translation: r.translation,
      partOfSpeech: r.partOfSpeech ?? undefined,
      comments: r.comments ?? undefined,
      source: r.source,
    }));
    entries.sort((a, b) => compareTsintskaroWords(a.word, b.word));
    this.cache = entries;
    this.cacheById = new Map(entries.map((e) => [e.word, e]));
    this.cacheByFolded = new Map();
    for (const entry of entries) {
      const folded = this.foldWordForLookup(entry.word);
      if (folded) {
        this.cacheByFolded.set(folded, [
          ...(this.cacheByFolded.get(folded) ?? []),
          entry,
        ]);
      }
      this.maxDictionaryPhraseWords = Math.max(
        this.maxDictionaryPhraseWords,
        this.tokenizeLookupText(entry.word).length,
      );
    }
    this.maxDictionaryPhraseWords = Math.min(this.maxDictionaryPhraseWords, 8);
    this.logger.log(`Loaded ${entries.length} dictionary entries from DB`);
  }

  async getEntries(): Promise<DictionaryEntry[]> {
    await this.ensureCache();
    return this.cache!;
  }

  async getFormattedForPrompt(): Promise<string> {
    await this.ensureCache();
    if (this.cache!.length === 0) return '';
    return this.formatEntriesForPrompt(this.cache!);
  }

  formatEntriesForPrompt(entries: DictionaryEntry[]): string {
    return entries.map((e) => `${e.word} = ${e.translation}`).join('\n');
  }

  async findRelevantForPrompt(
    messages: string[],
    limit = 100,
  ): Promise<DictionaryEntry[]> {
    await this.ensureCache();
    if (limit <= 0 || messages.length === 0 || this.cache!.length === 0) {
      return [];
    }

    const matches = new Map<
      string,
      { entry: DictionaryEntry; occurrences: number; exactOccurrences: number }
    >();

    for (const message of messages) {
      const tokens = this.tokenizeLookupText(message);
      for (let start = 0; start < tokens.length; start += 1) {
        const maxLength = Math.min(
          this.maxDictionaryPhraseWords,
          tokens.length - start,
        );
        for (let length = 1; length <= maxLength; length += 1) {
          const phrase = tokens.slice(start, start + length).join(' ');
          const folded = this.foldWordForLookup(phrase);
          if (!folded) continue;

          for (const entry of this.cacheByFolded!.get(folded) ?? []) {
            const key = `${entry.word}\u0000${entry.translation}`;
            const current = matches.get(key) ?? {
              entry,
              occurrences: 0,
              exactOccurrences: 0,
            };
            current.occurrences += 1;
            if (
              this.normalizePhraseForExactMatch(phrase) ===
              this.normalizePhraseForExactMatch(entry.word)
            ) {
              current.exactOccurrences += 1;
            }
            matches.set(key, current);
          }
        }
      }
    }

    return [...matches.values()]
      .sort(
        (a, b) =>
          b.exactOccurrences - a.exactOccurrences ||
          b.occurrences - a.occurrences ||
          compareTsintskaroWords(a.entry.word, b.entry.word),
      )
      .slice(0, limit)
      .map(({ entry }) => entry);
  }

  private tokenizeLookupText(value: string): string[] {
    return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  }

  private normalizePhraseForExactMatch(value: string): string {
    return this.tokenizeLookupText(value).join(' ');
  }

  async findWord(word: string): Promise<DictionaryEntry | undefined> {
    await this.ensureCache();
    const normalized = this.normalizeWordInput(word);
    if (!normalized) return undefined;

    const exact = this.cacheById!.get(normalized);
    if (exact) return exact;

    const folded = this.foldWordForLookup(normalized);
    if (!folded) return undefined;

    const candidates = this.cache!.filter(
      (entry) => this.foldWordForLookup(entry.word) === folded,
    );
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  async findByTranslation(translation: string): Promise<DictionaryEntry[]> {
    await this.ensureCache();
    const normalized = this.normalizeTranslationForCompare(translation);
    if (!normalized) return [];

    return this.cache!.filter((entry) => {
      const entryTranslation = this.normalizeTranslationForCompare(
        entry.translation,
      );
      if (entryTranslation === normalized) return true;

      const parts = entry.translation
        .split(/\s*(?:;|,|\/|\n)\s*/g)
        .map((part) => this.normalizeTranslationForCompare(part))
        .filter((part) => part.length > 0);
      return parts.includes(normalized);
    });
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

  async updateWord(input: UpdateWordInput): Promise<UpdateWordResult> {
    const requestedOldWord = this.normalizeWordInput(input.oldWord);
    const normalizedNewWord =
      input.newWord != null && input.newWord.trim()
        ? this.normalizeWordInput(input.newWord)
        : null;
    const translation =
      input.translation != null && input.translation.trim()
        ? input.translation.trim()
        : null;

    if (
      !requestedOldWord ||
      (!normalizedNewWord && !translation && input.partOfSpeech === undefined)
    ) {
      return { status: 'empty', requestedOldWord };
    }

    const resolvedOld = await this.resolveWordEntity(requestedOldWord);
    if (!resolvedOld.entity) {
      return {
        status: resolvedOld.candidates.length > 1 ? 'ambiguous' : 'not_found',
        requestedOldWord,
        candidates: resolvedOld.candidates.map((candidate) => candidate.word),
      };
    }

    const currentWord = resolvedOld.entity;
    const targetWord = normalizedNewWord ?? currentWord.word;
    const resolvedOldWord = currentWord.word;

    if (targetWord !== currentWord.word) {
      const resolvedTarget = await this.resolveWordEntity(targetWord);
      if (
        resolvedTarget.entity &&
        resolvedTarget.entity.id !== currentWord.id
      ) {
        const target = resolvedTarget.entity;
        if (translation) {
          target.translation = translation;
        }
        if (input.partOfSpeech !== undefined) {
          target.partOfSpeech = input.partOfSpeech;
        }
        target.source = 'chat';
        const saved = await this.wordRepo.save(target);
        await this.wordRepo.delete({ id: currentWord.id });
        this.invalidateCache();
        return {
          status: 'merged',
          requestedOldWord,
          resolvedOldWord,
          word: saved,
        };
      }
    }

    currentWord.word = targetWord;
    if (translation) {
      currentWord.translation = translation;
    }
    if (input.partOfSpeech !== undefined) {
      currentWord.partOfSpeech = input.partOfSpeech;
    }
    currentWord.source = 'chat';

    const saved = await this.wordRepo.save(currentWord);
    this.invalidateCache();

    return {
      status: 'updated',
      requestedOldWord,
      resolvedOldWord,
      word: saved,
    };
  }

  async upsertWord(input: UpsertWordInput): Promise<UpsertWordResult> {
    const normalizedWord = this.normalizeWordInput(input.word);
    const existing = await this.resolveWordEntityForUpsert(normalizedWord);

    if (existing) {
      const translationMerge = this.mergeTranslations(
        existing.translation,
        input.translation,
      );
      existing.translation = translationMerge.merged;
      const translationAdded = translationMerge.added !== undefined;
      const partOfSpeech = input.partOfSpeech?.trim();
      const partOfSpeechAdded = Boolean(partOfSpeech && !existing.partOfSpeech);

      if (partOfSpeechAdded) {
        existing.partOfSpeech = partOfSpeech!;
      }
      if (!translationAdded && !partOfSpeechAdded) {
        return { created: false, word: existing, translationAdded: false };
      }

      const saved = await this.wordRepo.save(existing);
      this.invalidateCache();
      return {
        created: false,
        word: saved,
        translationAdded,
        ...(translationMerge.added
          ? { addedTranslation: translationMerge.added }
          : {}),
      };
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
    return { created: true, word: saved, translationAdded: true };
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
