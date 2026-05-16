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

export interface DictionaryEntryInput {
  word: string;
  translation: string;
  partOfSpeech: string | null;
}

/** Result of processing a "Бот, ..." message */
export type BotMentionResult =
  | { action: 'add_words'; entries: DictionaryEntryInput[] }
  | { action: 'delete_words'; words: string[] }
  | { action: 'reply'; message: string };

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

  async processBotMention(text: string): Promise<BotMentionResult> {
    const dictionary = await this.dictionaryService.getFormattedForPrompt();
    const dictionarySection = dictionary
      ? `\nТЕКУЩИЙ СЛОВАРЬ (используй для ответов на вопросы о значениях слов):\n${dictionary}\n`
      : '';

    const prompt = `Ты помощник Telegram-бота в чате жителей села Цинцкаро (Грузия). Они говорят по-русски и используют слова цинцкарского диалекта (смесь старого азербайджанского и восточно-анатолийского турецкого, записан кириллицей). Главная функция бота — поддерживать словарь цинцкарского.

Пользователи обращаются к боту, начиная сообщение со слова "Бот". После этого они могут: добавить новое слово в словарь, спросить про значение слова, задать общий вопрос, поздороваться, поболтать.

ТВОЯ ЗАДАЧА: понять что хочет пользователь и вернуть одно из двух действий.

ВАРИАНТ 1 — ДОБАВИТЬ СЛОВА В СЛОВАРЬ. Выбирай этот вариант когда пользователь явно говорит "добавь", "запиши", "новое слово", "есть такое слово", "пиши", и при этом указывает пары "слово-перевод" (одну или несколько):
{"action": "add_words", "entries": [{"word": "...", "translation": "...", "partOfSpeech": "..." или null}, ...]}

ПРАВИЛА извлечения:
- "entries" — массив. Может быть из одного элемента, может из нескольких если в сообщении сразу несколько пар.
- "word" — цинцкарское слово, кириллицей, нижний регистр, без знаков препинания.
- "translation" — перевод на русский: одно слово, фраза, описание, несколько вариантов через запятую. Сохраняй примеры в скобках. НЕ обрезай длинные переводы.
- "partOfSpeech" — сокращённо ("сущ.", "гл.", "прил.", "нар.", "мест.", "межд.", "предл.", "союз", "числ.", "част.") если явно указана или однозначна. Иначе null.
- Игнорируй обращение и вводные слова ("Бот", "добавь", "запиши", "новое слово", "пожалуйста", "это", "и" и т.п.) — они не часть слова/перевода.
- Если в сообщении несколько слов — извлеки ВСЕ пары, не выбрасывай.

ВАРИАНТ 2 — УДАЛИТЬ КОНКРЕТНЫЕ СЛОВА ИЗ СЛОВАРЯ. Выбирай этот вариант когда пользователь явно говорит "удали", "убери", "сотри", "это не цинцкарское слово", "ошибка, не записывай" и указывает какое именно слово (или несколько) убрать:
{"action": "delete_words", "words": ["...", "..."]}

ПРАВИЛА:
- "words" — массив цинцкарских слов которые нужно удалить, кириллицей, в нижнем регистре, без знаков препинания.
- Извлекай только сами слова, не переводы.
- Максимум 10 слов за раз. Если просят больше — обрежь до 10.

🚫 ЗАПРЕЩЕНО — массовое удаление. Если пользователь просит "удали ВСЕ слова", "удали весь словарь", "очисти словарь", "удали всё на букву X", "удали все существительные", "удали ту половину" и любые другие массовые/общие удаления — НЕ возвращай action "delete_words". Вместо этого верни:
{"action": "reply", "message": "Массово удалить слова нельзя — это опасная операция. Если нужно удалить конкретные слова, перечисли их (до 10 за раз)."}

ВАРИАНТ 3 — ОТВЕТИТЬ ПОЛЬЗОВАТЕЛЮ (всё остальное: вопросы, болтовня, приветствия, просьбы что-то рассказать или объяснить):
{"action": "reply", "message": "твой ответ"}

ПРАВИЛА для ответа:
- На русском, дружелюбно, по делу. Максимум 3 предложения, лучше короче.
- Если спрашивают значение цинцкарского слова — ищи в словаре выше. Если слова там нет — честно скажи "такого слова в нашем словаре нет". НЕ выдумывай переводы цинцкарских слов из своей фантазии.
- Если просят перевести с русского на цинцкарский — ищи в словаре. Если нет — так и скажи.
- На общие вопросы (не про цинцкарский) отвечай как обычный ассистент.
- Если непонятно что хочет пользователь — мягко переспроси.
${dictionarySection}
Сообщение пользователя:
"""
${text}
"""

Ответь ТОЛЬКО валидным JSON.`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);

    if (parsed.action === 'add_words' && Array.isArray(parsed.entries)) {
      const entries: DictionaryEntryInput[] = [];
      for (const raw of parsed.entries) {
        if (
          raw &&
          typeof raw.word === 'string' &&
          typeof raw.translation === 'string' &&
          raw.word.trim() &&
          raw.translation.trim()
        ) {
          const pos =
            typeof raw.partOfSpeech === 'string' && raw.partOfSpeech.trim()
              ? raw.partOfSpeech.trim()
              : null;
          entries.push({
            word: raw.word.toLowerCase().trim(),
            translation: raw.translation.trim(),
            partOfSpeech: pos,
          });
        }
      }
      if (entries.length > 0) {
        return { action: 'add_words', entries };
      }
    }

    if (parsed.action === 'delete_words' && Array.isArray(parsed.words)) {
      const words = parsed.words
        .filter((w: unknown): w is string => typeof w === 'string' && w.trim().length > 0)
        .map((w: string) => w.toLowerCase().trim());
      if (words.length > 0) {
        return { action: 'delete_words', words };
      }
    }

    if (parsed.action === 'reply' && typeof parsed.message === 'string') {
      return { action: 'reply', message: parsed.message.trim() };
    }

    return {
      action: 'reply',
      message: 'Не понял что нужно сделать. Можешь переформулировать?',
    };
  }

  async analyzeMessages(messages: string[]): Promise<ExtractedWord[]> {
    const combinedText = messages.join('\n---\n');
    const dictionary = await this.dictionaryService.getFormattedForPrompt();

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

    const dictionary = await this.dictionaryService.getFormattedForPrompt();
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
