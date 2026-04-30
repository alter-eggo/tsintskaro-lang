import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import {
  DictionaryEntry,
  DictionaryService,
} from '../dictionary/dictionary.service';
import { PollHistory, PollDirection } from './entities/poll-history.entity';

const RECENT_DAYS = 30;
const OPTIONS_PER_QUIZ = 4;
const MAX_OPTION_LENGTH = 100;
const MAX_QUESTION_LENGTH = 300;

export interface GeneratedQuiz {
  question: string;
  options: string[];
  correctIndex: number;
  word: string;
  direction: PollDirection;
}

@Injectable()
export class PollGeneratorService {
  private readonly logger = new Logger(PollGeneratorService.name);

  constructor(
    private readonly dictionary: DictionaryService,
    @InjectRepository(PollHistory)
    private readonly historyRepo: Repository<PollHistory>,
  ) { }

  async generate(direction: PollDirection): Promise<GeneratedQuiz | null> {
    const entries = this.dictionary.getEntries();
    if (entries.length < OPTIONS_PER_QUIZ) {
      this.logger.warn(
        `Not enough dictionary entries (${entries.length}) to build a quiz`,
      );
      return null;
    }

    const recentWords = await this.getRecentlyUsedWords();
    const target = this.pickTarget(entries, recentWords);
    if (!target) return null;

    const distractors = this.pickDistractors(target, entries, direction);
    if (distractors.length < OPTIONS_PER_QUIZ - 1) {
      this.logger.warn(
        `Could not pick enough distractors for word "${target.word}"`,
      );
      return null;
    }

    const correctOption = this.toOption(target, direction);
    const wrongOptions = distractors.map((e) => this.toOption(e, direction));
    const options = this.shuffle([correctOption, ...wrongOptions]);
    const correctIndex = options.indexOf(correctOption);

    return {
      question: this.buildQuestion(target, direction),
      options,
      correctIndex,
      word: target.word,
      direction,
    };
  }

  async recordSent(
    quiz: GeneratedQuiz,
    chatId: number,
    threadId: number | null,
    pollId: string | null,
  ): Promise<void> {
    await this.historyRepo.save(
      this.historyRepo.create({
        word: quiz.word,
        direction: quiz.direction,
        chatId,
        threadId,
        pollId,
        sentAt: new Date(),
      }),
    );
  }

  private async getRecentlyUsedWords(): Promise<Set<string>> {
    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
    const rows = await this.historyRepo.find({
      where: { sentAt: MoreThan(since) },
      select: { word: true },
    });
    return new Set(rows.map((r) => r.word.toLowerCase()));
  }

  private pickTarget(
    entries: DictionaryEntry[],
    excludeWords: Set<string>,
  ): DictionaryEntry | null {
    const fresh = entries.filter(
      (e) =>
        !excludeWords.has(e.word.toLowerCase()) &&
        this.isOptionLengthOk(e.word) &&
        this.isOptionLengthOk(this.firstSense(e.translation)),
    );
    const pool = fresh.length > 0 ? fresh : entries;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  }

  private pickDistractors(
    target: DictionaryEntry,
    entries: DictionaryEntry[],
    direction: PollDirection,
  ): DictionaryEntry[] {
    const targetOption = this.toOption(target, direction);
    const targetWord = target.word.toLowerCase();

    const sameType = entries.filter(
      (e) =>
        e.word.toLowerCase() !== targetWord &&
        e.partOfSpeech &&
        target.partOfSpeech &&
        e.partOfSpeech === target.partOfSpeech &&
        this.toOption(e, direction) !== targetOption &&
        this.isOptionLengthOk(this.toOption(e, direction)),
    );

    const fallback = entries.filter(
      (e) =>
        e.word.toLowerCase() !== targetWord &&
        this.toOption(e, direction) !== targetOption &&
        this.isOptionLengthOk(this.toOption(e, direction)),
    );

    const picked: DictionaryEntry[] = [];
    const seenOptions = new Set<string>([targetOption]);

    const drainFrom = (pool: DictionaryEntry[]) => {
      const shuffled = this.shuffle([...pool]);
      for (const candidate of shuffled) {
        if (picked.length >= OPTIONS_PER_QUIZ - 1) break;
        const opt = this.toOption(candidate, direction);
        if (seenOptions.has(opt)) continue;
        seenOptions.add(opt);
        picked.push(candidate);
      }
    };

    drainFrom(sameType);
    if (picked.length < OPTIONS_PER_QUIZ - 1) drainFrom(fallback);

    return picked;
  }

  private toOption(entry: DictionaryEntry, direction: PollDirection): string {
    if (direction === 'ts_to_ru') {
      return this.truncate(this.firstSense(entry.translation));
    }
    return this.truncate(this.capitalize(entry.word));
  }

  private buildQuestion(
    target: DictionaryEntry,
    direction: PollDirection,
  ): string {
    if (direction === 'ts_to_ru') {
      const word = this.capitalize(target.word);
      return this.truncateQuestion(
        `Как перевести на русский «${word}»?`,
      );
    }
    const sense = this.firstSense(target.translation);
    return this.truncateQuestion(
      `Как перевести на цинцкарский «${sense}»?`,
    );
  }

  private firstSense(translation: string): string {
    const first = translation.split(/[,;]/)[0] ?? translation;
    return first.trim();
  }

  private capitalize(word: string): string {
    if (!word) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  private isOptionLengthOk(text: string): boolean {
    return text.length > 0 && text.length <= MAX_OPTION_LENGTH;
  }

  private truncate(text: string): string {
    if (text.length <= MAX_OPTION_LENGTH) return text;
    return text.slice(0, MAX_OPTION_LENGTH - 1) + '…';
  }

  private truncateQuestion(text: string): string {
    if (text.length <= MAX_QUESTION_LENGTH) return text;
    return text.slice(0, MAX_QUESTION_LENGTH - 1) + '…';
  }

  private shuffle<T>(arr: T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
