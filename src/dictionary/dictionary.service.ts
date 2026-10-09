import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Word, type WordSource } from './entities/word.entity';
import { WordTranslationHistory } from './entities/word-translation-history.entity';
import {
  assertEditableWord,
  DictionaryContentError,
  WordKind,
  WordSense,
} from './dictionary-content';
import { DictionaryEdit } from './dictionary-edit';
import { DictionaryActor, DictionaryEditor } from './dictionary-editor';
import { WordEditHistory } from './entities/word-edit-history.entity';
import { WORD_DELETION_DENIED } from './deletion-permissions';
import {
  actionWords,
  DictionaryAction,
  DictionarySnapshot,
  dictionarySnapshot,
  inspectDictionaryRecord,
  dictionaryWord,
  parseDictionaryActions,
} from './dictionary-actions';
import { compareTsintskaroWords } from './tsintskaro-alphabet';
import { assertCanEditTranslations } from './translation-permissions';

export interface DictionaryEntry {
  word: string;
  translation: string;
  partOfSpeech?: string;
  comments?: string;
  source?: WordSource;
  senses?: WordSense[];
  kind?: WordKind;
  literalTranslation?: string;
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

export interface ReplaceTranslationInput {
  word: string;
  translation: string;
  userId: number;
  username?: string | null;
  chatId: number;
  threadId?: number | null;
  messageId?: number | null;
}

export type ReplaceTranslationResult =
  | { status: 'invalid'; word: string }
  | { status: 'not_found'; word: string }
  | {
      status: 'updated' | 'unchanged';
      word: string;
      previousTranslation: string;
      translation: string;
    };

export interface UpdateWordInput {
  oldWord: string;
  newWord?: string | null;
  translation?: string | null;
  partOfSpeech?: string | null;
  updatedBy?: string | null;
  userId?: number;
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
  private cacheLoadedAt = 0;
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(
    @InjectRepository(Word)
    private readonly wordRepo: Repository<Word>,
  ) {}

  async editRecord(edit: DictionaryEdit, actor: DictionaryActor) {
    const result = await new DictionaryEditor(this.wordRepo).apply(edit, actor);
    this.invalidateCache();
    return result;
  }

  async getDeferredRecords(): Promise<Word[]> {
    return this.wordRepo.find({
      where: { status: 'deferred' },
      order: { word: 'ASC' },
    });
  }

  async inspectRecords(words: string[]) {
    const names = [...new Set(words.map(dictionaryWord))];
    const rows = names.length
      ? await this.wordRepo.find({ where: { word: In(names) } })
      : [];
    return names.map((word) => {
      const row = rows.find((row) => row.word === word);
      return inspectDictionaryRecord(word, row);
    });
  }

  /** One authorized message is one transaction, including mixed operations. */
  async applyActions(
    raw: DictionaryAction[],
    actor: DictionaryActor,
    snapshots: DictionarySnapshot[],
  ) {
    const actions = parseDictionaryActions(raw);
    if (!actions || !Number.isSafeInteger(actor.userId) || actor.userId <= 0)
      throw new DictionaryContentError(
        'Не удалось проверить команду. Ничего не изменено.',
      );
    for (const action of actions) {
      if (
        action.type !== 'add_word' &&
        action.type !== 'delete_word' &&
        !(action.type === 'update_word' && !action.translation)
      )
        assertCanEditTranslations(actor.username);
      if (
        (action.type === 'delete_word' ||
          action.type === 'move_example' ||
          (action.type === 'set_status' && action.status === 'deferred')) &&
        !actor.canRemoveEntry
      )
        throw new DictionaryContentError(WORD_DELETION_DENIED);
    }
    const names = actionWords(actions);
    const result = await this.wordRepo.manager.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('tsintskaro.dictionary-edits'))",
      );
      const repo = manager.getRepository(Word);
      const history = manager.getRepository(WordEditHistory);
      const requestKey =
        actor.chatId != null && actor.messageId != null
          ? `${actor.chatId}:${actor.messageId}:actions`
          : null;
      const replay = requestKey
        ? await history.findOneBy({ requestKey })
        : null;
      if (replay) {
        const ids = (replay.after as Word[]).map((row) => row.id);
        return {
          unchanged: true,
          words: ids.length ? await repo.findBy({ id: In(ids) }) : [],
        };
      }
      const before = await repo.find({
        where: { word: In(names) },
        lock: { mode: 'pessimistic_write' },
      });
      for (const word of names) {
        const snapshot = snapshots.find((item) => item.word === word);
        if (
          !snapshot ||
          snapshot.version !==
            dictionarySnapshot(
              word,
              before.find((row) => row.word === word),
            ).version
        )
          throw new DictionaryContentError(
            `Запись «${word}» не проверена или изменилась после чтения. Ничего не изменено; повтори просьбу, чтобы я перечитал словарь.`,
          );
      }
      const service = new DictionaryService(repo);
      for (let index = 0; index < actions.length; index++) {
        const action = actions[index];
        const row = await repo.findOneBy({ word: action.word });
        if (action.type !== 'add_word' && !row)
          throw new DictionaryContentError(
            `Не нашёл запись «${action.word}». Ничего не изменено.`,
          );
        if (action.type === 'add_word') {
          const saved = await service.upsertWord({
            ...action,
            addedBy: actor.username,
          });
          if (saved.word.word !== action.word)
            throw new DictionaryContentError(
              `Уточни написание: «${action.word}» совпадает с другой записью. Ничего не изменено.`,
            );
        } else if (action.type === 'update_word') {
          const updated = await service.updateWord({
            oldWord: action.word,
            newWord: action.newWord,
            translation: action.translation,
            partOfSpeech: action.partOfSpeech,
            updatedBy: actor.username,
            userId: actor.userId,
          });
          if (
            !updated.word ||
            !['updated', 'merged'].includes(updated.status) ||
            updated.word.word !== (action.newWord ?? action.word)
          )
            throw new DictionaryContentError(
              `Не удалось однозначно исправить «${action.word}». Ничего не изменено.`,
            );
        } else if (action.type === 'delete_word') {
          await service.deleteWords([action.word]);
        } else {
          await new DictionaryEditor(repo).apply(action, {
            ...actor,
            operationIndex: index,
          });
        }
      }
      const after = await repo.find({
        where: [{ word: In(names) }, { id: In(before.map((row) => row.id)) }],
      });
      await history.save(
        history.create({
          operation: 'dictionary_actions',
          requestKey,
          before,
          after,
          actor,
        }),
      );
      return { unchanged: false, words: after };
    });
    this.invalidateCache();
    return result;
  }

  private invalidateCache() {
    this.cache = null;
    this.cacheById = null;
    this.cacheByFolded = null;
    this.maxDictionaryPhraseWords = 1;
  }

  private normalizeWordInput(word: string): string {
    return word
      .normalize('NFC')
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
      .replace(/[^0-9а-яê]+/gi, '');
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

    if (
      [current, next].some((text) => /(?:^|[;\n]\s*|\s+)\d+[).]\s/.test(text))
    ) {
      throw new DictionaryContentError(
        'Для нумерованных значений укажи номер отдельно. Например: «Баласи, добавь вариант перевода: аваралых — 3) ерунда». Существующие значения сохранены.',
      );
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
    if (
      this.cache &&
      this.cacheById &&
      this.cacheByFolded &&
      Date.now() - this.cacheLoadedAt < DictionaryService.CACHE_TTL_MS
    )
      return;
    const rows = await this.wordRepo.find();
    const activeRows = rows.filter((r) => !r.status || r.status === 'active');
    const entries: DictionaryEntry[] = activeRows.map((r) => ({
      word: r.word,
      translation: r.translation,
      partOfSpeech: r.partOfSpeech ?? undefined,
      comments: r.comments ?? undefined,
      source: r.source,
      ...(r.senses?.length ? { senses: r.senses } : {}),
      ...(r.kind && r.kind !== 'word' ? { kind: r.kind } : {}),
      ...(r.literalTranslation
        ? { literalTranslation: r.literalTranslation }
        : {}),
    }));
    entries.sort((a, b) => compareTsintskaroWords(a.word, b.word));
    this.cache = entries;
    this.cacheById = new Map(entries.map((e) => [e.word, e]));
    this.cacheByFolded = new Map();
    this.maxDictionaryPhraseWords = 1;
    const aliases = entries.flatMap((entry) => [
      { phrase: entry.word, entry },
      ...(entry.senses ?? []).flatMap((s) =>
        s.examples.flatMap((e) =>
          [e.phrase, ...(e.aliases ?? [])].map((phrase) => ({ phrase, entry })),
        ),
      ),
    ]);
    const byName = new Map(entries.map((entry) => [entry.word, entry]));
    const byId = new Map(
      activeRows.map((row) => [row.id, byName.get(row.word)!]),
    );
    for (const row of rows) {
      if (
        (row.status === 'embedded' || row.status === 'merged') &&
        byId.has(row.relatedWordId)
      )
        aliases.push({ phrase: row.word, entry: byId.get(row.relatedWordId)! });
    }
    const exactAliases = new Map<string, Set<DictionaryEntry>>();
    for (const { phrase, entry } of aliases) {
      const normalized = this.normalizeWordInput(phrase);
      const exactMatches = exactAliases.get(normalized) ?? new Set();
      exactMatches.add(entry);
      exactAliases.set(normalized, exactMatches);
      const folded = this.foldWordForLookup(phrase);
      if (folded) {
        const matches = this.cacheByFolded.get(folded) ?? [];
        if (!matches.includes(entry)) matches.push(entry);
        this.cacheByFolded.set(folded, matches);
      }
      this.maxDictionaryPhraseWords = Math.max(
        this.maxDictionaryPhraseWords,
        this.tokenizeLookupText(phrase).length,
      );
    }
    for (const [phrase, matches] of exactAliases) {
      if (!this.cacheById.has(phrase) && matches.size === 1)
        this.cacheById.set(phrase, [...matches][0]);
    }
    this.maxDictionaryPhraseWords = Math.min(this.maxDictionaryPhraseWords, 8);
    this.cacheLoadedAt = Date.now();
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
    return entries
      .map(
        (e) =>
          `${e.word} = ${e.translation}${e.literalTranslation ? `; буквально: ${e.literalTranslation}` : ''}`,
      )
      .join('\n');
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
    return (
      value
        .normalize('NFC')
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    );
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

    const candidates = this.cacheByFolded!.get(folded) ?? [];
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  async findByTranslation(translation: string): Promise<DictionaryEntry[]> {
    await this.ensureCache();
    const normalized = this.normalizeTranslationForCompare(translation);
    if (!normalized) return [];

    const exactMatches: DictionaryEntry[] = [];
    const phraseMatches: DictionaryEntry[] = [];
    const queryTokens = this.tokenizeTranslationForLookup(normalized);
    const canUsePhraseMatch =
      normalized.length >= 3 && queryTokens.some((token) => token.length >= 3);

    for (const entry of this.cache!) {
      const entryTranslation = this.normalizeTranslationForCompare(
        entry.translation,
      );

      const parts = [entry.translation, entry.literalTranslation]
        .filter(Boolean)
        .join('; ')
        .split(/\s*(?:;|,|\/|\n)\s*/g)
        .map((part) => this.normalizeTranslationForCompare(part))
        .filter((part) => part.length > 0);
      if (entryTranslation === normalized || parts.includes(normalized)) {
        exactMatches.push(entry);
        continue;
      }

      if (
        canUsePhraseMatch &&
        parts.some((part) =>
          this.containsTokenSequence(
            this.tokenizeTranslationForLookup(part),
            queryTokens,
          ),
        )
      ) {
        phraseMatches.push(entry);
      }
    }

    return [...exactMatches, ...phraseMatches];
  }

  private tokenizeTranslationForLookup(value: string): string[] {
    return (
      this.normalizeTranslationForCompare(value).match(/[\p{L}\p{N}]+/gu) ?? []
    );
  }

  private containsTokenSequence(
    tokens: string[],
    queryTokens: string[],
  ): boolean {
    if (queryTokens.length === 0 || queryTokens.length > tokens.length) {
      return false;
    }

    for (
      let start = 0;
      start <= tokens.length - queryTokens.length;
      start += 1
    ) {
      if (
        queryTokens.every(
          (queryToken, index) => tokens[start + index] === queryToken,
        )
      ) {
        return true;
      }
    }

    return false;
  }

  async deleteWords(
    words: string[],
  ): Promise<{ deleted: string[]; notFound: string[] }> {
    const normalized = Array.from(
      new Set(
        words
          .map((w) => this.normalizeWordInput(w))
          .filter((w) => w.length > 0),
      ),
    );
    if (normalized.length === 0) {
      return { deleted: [], notFound: [] };
    }

    const result = await this.wordRepo.manager.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('tsintskaro.dictionary-edits'))",
      );
      const repo = manager.getRepository(Word);
      const existing = await repo
        .createQueryBuilder('word')
        .where('word.word IN (:...names)', { names: normalized })
        .orderBy('word.id', 'ASC')
        .setLock('pessimistic_write')
        .getMany();
      if (
        existing.some((e) => e.status === 'embedded' || e.status === 'merged')
      )
        throw new DictionaryContentError(
          'Выражение уже перенесено. Изменяй пример в основной записи.',
        );
      const existingSet = new Set(
        existing.filter((e) => e.status !== 'deleted').map((e) => e.word),
      );

      const deleted = normalized.filter((w) => existingSet.has(w));
      const notFound = normalized.filter((w) => !existingSet.has(w));

      if (deleted.length > 0) {
        await repo.update({ word: In(deleted) }, { status: 'deleted' });
      }

      return { deleted, notFound };
    });
    this.invalidateCache();
    return result;
  }

  async replaceTranslation(
    input: ReplaceTranslationInput,
  ): Promise<ReplaceTranslationResult> {
    assertCanEditTranslations(input.username);
    const word = this.normalizeWordInput(input.word);
    const translation = input.translation.trim();
    if (
      !word ||
      word.length > 255 ||
      !translation ||
      !Number.isSafeInteger(input.userId)
    ) {
      return { status: 'invalid', word };
    }
    const result =
      await this.wordRepo.manager.transaction<ReplaceTranslationResult>(
        async (manager) => {
          const words = manager.getRepository(Word);
          // Replacement requires the exact spelling, never a fuzzy match to another word.
          const current = await words.findOne({
            where: { word },
            lock: { mode: 'pessimistic_write' },
          });
          if (!current) return { status: 'not_found', word };
          assertEditableWord(current);
          if (current.senses?.length)
            throw new DictionaryContentError(
              'В записи есть отдельные значения и примеры. Укажи номер значения: «Баласи, измени значение 3 слова «аваралых» на «ерунда»».',
            );
          const previousTranslation = current.translation;
          if (previousTranslation === translation) {
            return {
              status: 'unchanged',
              word: current.word,
              previousTranslation,
              translation,
            };
          }
          const history = manager.getRepository(WordTranslationHistory);
          await history.save(
            history.create({
              wordId: current.id,
              word: current.word,
              previousTranslation,
              translation,
              userId: input.userId,
              username: input.username ?? null,
              chatId: input.chatId,
              threadId: input.threadId ?? null,
              messageId: input.messageId ?? null,
            }),
          );
          await words.update({ id: current.id }, { translation });
          return {
            status: 'updated',
            word: current.word,
            previousTranslation,
            translation,
          };
        },
      );
    if (result.status === 'updated') this.invalidateCache();
    return result;
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
    if (translation) assertCanEditTranslations(input.updatedBy);

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
    const previousTranslation = currentWord.translation;
    assertEditableWord(currentWord);
    if (translation && currentWord.senses?.length)
      throw new DictionaryContentError(
        'В записи есть отдельные значения и примеры. Измени нужное значение по номеру.',
      );
    const targetWord = normalizedNewWord ?? currentWord.word;
    const resolvedOldWord = currentWord.word;

    if (targetWord !== currentWord.word) {
      const resolvedTarget = await this.resolveWordEntity(targetWord);
      if (
        resolvedTarget.entity &&
        resolvedTarget.entity.id !== currentWord.id
      ) {
        const target = resolvedTarget.entity;
        // Merging removes an existing entry and can discard its meanings.
        assertCanEditTranslations(input.updatedBy);
        const saved = await new DictionaryEditor(this.wordRepo).merge(
          currentWord.id,
          target.id,
          { username: input.updatedBy!, userId: input.userId },
          translation ?? undefined,
          input.partOfSpeech,
        );
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

    // A spelling/POS edit must not write back a stale translation that another
    // participant read before an authorized editor changed it.
    const updated = await this.wordRepo.update(
      {
        id: currentWord.id,
        status: In(['active', 'deferred']),
        ...(translation
          ? { translation: previousTranslation, senses: IsNull() }
          : {}),
      },
      {
        word: targetWord,
        source: 'chat',
        ...(translation ? { translation } : {}),
        ...(input.partOfSpeech !== undefined
          ? { partOfSpeech: input.partOfSpeech }
          : {}),
      },
    );
    if (updated.affected === 0)
      throw new DictionaryContentError(
        'Запись изменилась одновременно с этой командой. Перечитай её и повтори исправление.',
      );
    this.invalidateCache();

    return {
      status: 'updated',
      requestedOldWord,
      resolvedOldWord,
      word: currentWord,
    };
  }

  async upsertWord(input: UpsertWordInput): Promise<UpsertWordResult> {
    const normalizedWord = this.normalizeWordInput(input.word);
    const existing = await this.resolveWordEntityForUpsert(normalizedWord);

    if (existing) {
      assertEditableWord(existing);
      if (
        existing.senses?.length &&
        input.translation.trim() !== existing.translation
      )
        throw new DictionaryContentError(
          'У этой записи значения хранятся отдельно. Добавь значение с номером или пример к существующему значению.',
        );
      const translationMerge = this.mergeTranslations(
        existing.translation,
        input.translation,
      );
      const translationAdded = translationMerge.added !== undefined;
      const previousTranslation = existing.translation;
      if (translationAdded) {
        assertCanEditTranslations(input.addedBy);
        existing.translation = translationMerge.merged;
      }
      const partOfSpeech = input.partOfSpeech?.trim();
      const partOfSpeechAdded = Boolean(partOfSpeech && !existing.partOfSpeech);

      if (partOfSpeechAdded) {
        existing.partOfSpeech = partOfSpeech!;
      }
      if (!translationAdded && !partOfSpeechAdded) {
        return { created: false, word: existing, translationAdded: false };
      }

      const saved = existing;
      if (translationAdded) {
        const updated = await this.wordRepo.update(
          {
            id: existing.id,
            translation: previousTranslation,
            senses: IsNull(),
            status: In(['active', 'deferred']),
          },
          {
            translation: existing.translation,
            ...(partOfSpeechAdded
              ? { partOfSpeech: existing.partOfSpeech }
              : {}),
          },
        );
        if (updated.affected === 0)
          throw new DictionaryContentError(
            'Запись изменилась одновременно с этой командой. Повтори добавление значения.',
          );
      } else
        await this.wordRepo.update(
          { id: existing.id, status: In(['active', 'deferred']) },
          { partOfSpeech: existing.partOfSpeech },
        );
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
