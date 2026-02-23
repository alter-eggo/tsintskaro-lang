import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { DictionaryService } from '../dictionary/dictionary.service';

interface ExtractedWord {
  word: string;
  possibleTranslation: string | null;
  context: string;
}

/** Raw entry from chat: one suggestion per participant */
export interface ProcessDiscussionEntry {
  word: string;
  translation: string;
  partOfSpeech: string;
  username: string;
}

/** Result of processDiscussion: summary + flat entries for dedup in code */
export interface ProcessDiscussionRawResult {
  discussionSummary: string;
  entries: ProcessDiscussionEntry[];
}

/** Agreed word (single translation) */
export interface AgreedWord {
  word: string;
  translation: string;
  partOfSpeech: string;
}

/** Disputed word (multiple variants) */
export interface DisputedWord {
  word: string;
  partOfSpeech: string;
  translationVariants: { username: string; translation: string }[];
  comments?: string;
}

/** Final result for report (agreed/disputed words + discussion summary) */
export interface ProcessDiscussionResult {
  discussionSummary: string;
  agreedWords: AgreedWord[];
  disputedWords: DisputedWord[];
  totalExtracted: number;
  duplicatesRemoved: number;
}

const MODEL_NAME = 'gpt-5.2';

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor(
    private config: ConfigService,
    private dictionaryService: DictionaryService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get('openaiKey'),
    });
  }

  async analyzeMessages(messages: string[]): Promise<ExtractedWord[]> {
    const combinedText = messages.join('\n---\n');
    const dictionary = this.dictionaryService.getFormattedForPrompt();

    const dictionarySection = dictionary
      ? `\nИзвестные слова из словаря (используй эти переводы):\n${dictionary}\n`
      : '';

    const prompt = `Ты лингвистический аналитик. Ниже сообщения из Telegram-чата жителей села Цинцкаро (Грузия). 
    Они говорят по-русски, но вставляют слова из родного языка — смеси из старого азербайджанского диалекта и восточно-анатолийского диалекта турецкого языка, записанных кириллицей.
${dictionarySection}
Твоя задача:
1. Найти слова, которые НЕ являются стандартным русским языком — это слова из цинцкарского диалекта
2. Если слово есть в словаре выше — используй перевод оттуда
3. Если слова нет в словаре — попробуй угадать перевод по контексту (если невозможно — напиши null)
4. Добавь короткий контекст, где слово было использовано

Сообщения:
${combinedText}

Отвечай ТОЛЬКО в формате JSON:
{
  "words": [
    {
      "word": "нерусское слово",
      "possibleTranslation": "перевод на русский или null",
      "context": "короткая фраза где появилось"
    }
  ]
}

Если нерусских слов не найдено, верни {"words": []}`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    return parsed.words || [];
  }

  async compileList(
    messages: { text: string; username: string }[],
  ): Promise<string> {
    const formattedMessages = messages
      .map((m) => `[${m.username}]: ${m.text}`)
      .join('\n');

    const prompt = `Ты помощник по составлению словаря цинцкарского диалекта.

Проанализируй сообщения из чата. В них содержится:
1. Список слов цинцкарского диалекта (формат: слово - перевод или слово = перевод)
2. Обсуждение и корректировки от участников

Твоя задача:
1. Найди исходный список слов (обычно это большое сообщение со списком слово - перевод)
2. Найди ВСЕ корректировки от участников:
   - Исправления перевода ("нет, это значит...", "неправильно", "исправить на...")
   - Удаления ("это не цинцкарское слово", "удалить", "это турецкий/русский")
   - Добавления ("добавить слово...", "ещё есть...")
   - Уточнения значений
3. Примени все корректировки к исходному списку
4. Удали дубликаты (одинаковые слова)
5. Если участники предлагают РАЗНЫЕ переводы — отметь как "⚠️ спорное"

СООБЩЕНИЯ:
${formattedMessages}

Ответь в формате:

📝 <b>ОБНОВЛЁННЫЙ СПИСОК</b>

[Нумерованный список в формате:]
1. <b>Слово</b> - перевод
2. <b>Слово</b> - перевод ⚠️ спорное: вариант2 (username)
...

📊 <b>ИТОГ:</b>
- Всего слов: X
- Исправлено: X
- Добавлено: X
- Удалено: X
- Спорных: X

🗑 <b>УДАЛЁННЫЕ СЛОВА</b> (если есть):
- слово (причина, username)`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.choices[0].message.content || 'Ошибка обработки';
  }

  /**
   * Обрабатывает обсуждение: извлекает слова, убирает точные дубликаты,
   * объединяет разные мнения в комментарии. Весь текст — на русском.
   */
  async processDiscussion(
    messages: { text: string; username: string }[],
  ): Promise<ProcessDiscussionResult> {
    const formattedMessages = messages
      .map((m) => `[${m.username}]: ${m.text}`)
      .join('\n');

    const dictionary = this.dictionaryService.getFormattedForPrompt();
    const dictionarySection = dictionary
      ? `\nИзвестные слова из словаря (предпочтительные переводы):\n${dictionary}\n`
      : '';

    const prompt = `Ты помощник по составлению словаря цинцкарского диалекта. Ниже — сообщения из Telegram-чата жителей села Цинцкаро. Они говорят по-русски и вставляют слова цинцкарского диалекта (смесь старого азербайджанского и восточно-анатолийского турецкого, записаны кириллицей).
${dictionarySection}
Твои задачи:
1. Написать подробное описание обсуждения на русском: о чём говорили, какие темы поднимались, кто участвовал и что вносил, ключевые реплики и уточнения, где были разногласия, сколько слов в итоге предложено и как они распределились (согласованные и спорные). Описание должно быть развёрнутым, а не в два предложения.
2. Извлечь из чата ВСЕ предложенные слова цинцкарского диалекта. Для каждого указать: слово (кириллицей), перевод на русский, часть речи (сокращённо: сущ., гл., прил., межд. и т.д.), имя пользователя (username), кто это предложил или уточнил.

Если один и тот же вариант слова (слово + перевод + часть речи) повторяется несколькими людьми — всё равно выводи каждое вхождение отдельно (дубликаты будут удалены автоматически).
Если по одному слову разные участники дают разные переводы или части речи — выводи каждый вариант с указанием username.

Ответь ТОЛЬКО в формате JSON на русском:
{
  "discussionSummary": "Подробное описание обсуждения: темы, участники и их вклад, ключевые реплики, разногласия, итог по словам (развёрнутый текст).",
  "entries": [
    {
      "word": "слово цинцкарского диалекта кириллицей",
      "translation": "перевод на русский",
      "partOfSpeech": "сущ.",
      "username": "username из сообщения"
    }
  ]
}

Сообщения:
${formattedMessages}

Если слов не найдено, верни: {"discussionSummary": "...", "entries": []}`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content) as ProcessDiscussionRawResult;

    const summary =
      parsed.discussionSummary || 'Подробное описание не сформировано.';
    const entries = parsed.entries || [];

    const { agreedWords, disputedWords, duplicatesRemoved } =
      this.deduplicateAndSplit(entries);

    return {
      discussionSummary: summary,
      agreedWords,
      disputedWords,
      totalExtracted: entries.length,
      duplicatesRemoved,
    };
  }

  /**
   * Группирует по слову: одинаковые (слово, перевод, часть речи) — один согласованный; разные варианты — спорное с вариантами.
   */
  private deduplicateAndSplit(entries: ProcessDiscussionEntry[]): {
    agreedWords: AgreedWord[];
    disputedWords: DisputedWord[];
    duplicatesRemoved: number;
  } {
    const byWord = new Map<string, ProcessDiscussionEntry[]>();
    for (const e of entries) {
      const word = e.word.trim();
      if (!word) continue;
      if (!byWord.has(word)) byWord.set(word, []);
      byWord.get(word)!.push(e);
    }

    const agreedWords: AgreedWord[] = [];
    const disputedWords: DisputedWord[] = [];
    let duplicatesRemoved = 0;

    for (const [, group] of byWord) {
      const uniqueByTranslationAndPOS = new Map<
        string,
        { translation: string; partOfSpeech: string; usernames: string[] }
      >();
      for (const e of group) {
        const key = `${e.translation.trim()}\t${e.partOfSpeech.trim()}`;
        if (!uniqueByTranslationAndPOS.has(key)) {
          uniqueByTranslationAndPOS.set(key, {
            translation: e.translation.trim(),
            partOfSpeech: e.partOfSpeech.trim(),
            usernames: [],
          });
        }
        uniqueByTranslationAndPOS.get(key)!.usernames.push(e.username);
      }

      if (uniqueByTranslationAndPOS.size === 1) {
        const only = [...uniqueByTranslationAndPOS.values()][0];
        agreedWords.push({
          word: group[0].word.trim(),
          translation: only.translation,
          partOfSpeech: only.partOfSpeech,
        });
        duplicatesRemoved += group.length - 1;
      } else {
        const byTranslation = new Map<string, string>();
        const partOfSpeeches = new Set<string>();
        for (const e of group) {
          const t = e.translation.trim();
          if (!byTranslation.has(t)) byTranslation.set(t, e.username);
          partOfSpeeches.add(e.partOfSpeech.trim());
        }
        const variants = [...byTranslation.entries()].map(
          ([translation, username]) => ({
            username,
            translation,
          }),
        );
        const partOfSpeech =
          [...partOfSpeeches].join(' / ') || group[0].partOfSpeech.trim();
        disputedWords.push({
          word: group[0].word.trim(),
          partOfSpeech,
          translationVariants: variants,
          comments: 'Требуется дополнительное обсуждение',
        });
      }
    }

    return { agreedWords, disputedWords, duplicatesRemoved };
  }
}
