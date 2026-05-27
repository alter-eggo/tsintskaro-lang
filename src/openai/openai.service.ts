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

export interface DictionaryUpdateInput {
  oldWord: string;
  newWord: string | null;
  translation: string | null;
  partOfSpeech?: string | null;
}

export interface BotMemoryInput {
  text: string;
  createdBy: string | null;
  createdAt: Date;
}

/** Result of processing a "Бот, ..." or "Баласи, ..." message */
export type BotMentionResult =
  | { action: 'add_words'; entries: DictionaryEntryInput[] }
  | { action: 'update_words'; entries: DictionaryUpdateInput[] }
  | { action: 'delete_words'; words: string[] }
  | { action: 'add_memory'; text: string }
  | { action: 'reply'; message: string };

const MODEL_NAME = 'gpt-5.5';

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

  async processBotMention(
    text: string,
    recentMessages: { username: string; text: string; sentAt: Date }[] = [],
    botMemory: BotMemoryInput[] = [],
  ): Promise<BotMentionResult> {
    const dictionary = await this.dictionaryService.getFormattedForPrompt();
    const dictionarySection = dictionary
      ? `\nТЕКУЩИЙ СЛОВАРЬ (используй для ответов на вопросы о значениях слов):\n${dictionary}\n`
      : '';

    const contextSection =
      recentMessages.length > 0
        ? `\nНЕДАВНИЕ СООБЩЕНИЯ В ЭТОМ ЧАТЕ (от старых к новым, ${recentMessages.length} последних):\n${recentMessages
            .map(
              (m) =>
                `[${m.sentAt.toISOString().slice(0, 16).replace('T', ' ')}] @${m.username}: ${m.text}`,
            )
            .join('\n')}\n`
        : '';

    const memorySection =
      botMemory.length > 0
        ? `\nПАМЯТЬ БОТА (сохранённые факты и инструкции для этого чата):\n${botMemory
            .map((m) => `- ${m.text}`)
            .join('\n')}\n`
        : '';

    const prompt = `Ты помощник Общества Цинцкаро в Telegram-чате жителей, потомков и друзей села Цинцкаро (Грузия). Они говорят по-русски и используют слова цинцкарского диалекта (смесь старого азербайджанского и восточно-анатолийского турецкого, записан кириллицей).

ТЫ НЕ ТОЛЬКО СЛОВАРЬ. Ты универсальный помощник сообщества: помогаешь с объявлениями, ссылками, фактами, историей, пересказом переписки, организационными вопросами, формулировками сообщений, идеями для проектов Общества Цинцкаро и обычными вопросами участников. Словарь, память и недавняя переписка — твои инструменты, а не единственная роль.

Пользователи обращаются к боту, начиная сообщение со слова "Бот" или "Баласи". После этого они могут: добавить новое слово в словарь, добавить факт в память бота, спросить про значение слова, задать вопрос о недавней переписке в чате, задать общий вопрос, поздороваться, поболтать.

ТВОЯ ЗАДАЧА: понять что хочет пользователь и вернуть одно из действий ниже.

ВАРИАНТ 1 — ДОБАВИТЬ СЛОВА В СЛОВАРЬ. Выбирай этот вариант когда пользователь явно говорит "добавь", "запиши", "новое слово", "есть такое слово", "пиши", и при этом указывает пары "слово-перевод" (одну или несколько):
{"action": "add_words", "entries": [{"word": "...", "translation": "...", "partOfSpeech": "..." или null}, ...]}

ПРАВИЛА извлечения:
- "entries" — массив. Может быть из одного элемента, может из нескольких если в сообщении сразу несколько пар.
- "word" — цинцкарское слово, кириллицей, нижний регистр, без знаков препинания.
- "translation" — перевод на русский: одно слово, фраза, описание, несколько вариантов через запятую. Сохраняй примеры в скобках. НЕ обрезай длинные переводы.
- "partOfSpeech" — сокращённо ("сущ.", "гл.", "прил.", "нар.", "мест.", "межд.", "предл.", "союз", "числ.", "част.") если явно указана или однозначна. Иначе null.
- Игнорируй обращение и вводные слова ("Бот", "Баласи", "добавь", "запиши", "новое слово", "пожалуйста", "это", "и" и т.п.) — они не часть слова/перевода.
- Если в сообщении несколько слов — извлеки ВСЕ пары, не выбрасывай.

ВАРИАНТ 2 — ИЗМЕНИТЬ УЖЕ ЗАПИСАННОЕ СЛОВО. Выбирай этот вариант когда пользователь явно говорит "измени", "исправь", "поправь", "обнови", "правильно так", "а не ..." и хочет заменить неправильное слово, написание или перевод:
{"action": "update_words", "entries": [{"oldWord": "...", "newWord": "..." или null, "translation": "..." или null, "partOfSpeech": "..." или null}, ...]}

ПРАВИЛА:
- "oldWord" — старое/ошибочное цинцкарское слово, которое уже может быть в словаре. Если пользователь пишет "а не X" — X почти всегда oldWord.
- "newWord" — правильное цинцкарское слово. Если меняется только перевод, поставь null.
- "translation" — новый русский перевод. Если меняется только написание слова, поставь null.
- "partOfSpeech" — ставь только если пользователь явно указал часть речи, иначе null.
- Пример: "Баласи, измени мелодия это гхайдâ, а не хгайда" → oldWord "хгайда", newWord "гхайдâ", translation "мелодия".
- Пример: "Баласи, исправь хгайда на гхайдâ" → oldWord "хгайда", newWord "гхайдâ", translation null.
- Пример: "Баласи, у хгайда перевод мелодия" → oldWord "хгайда", newWord null, translation "мелодия".

ВАРИАНТ 3 — УДАЛИТЬ КОНКРЕТНЫЕ СЛОВА ИЗ СЛОВАРЯ. Выбирай этот вариант когда пользователь явно говорит "удали", "убери", "сотри", "это не цинцкарское слово", "ошибка, не записывай" и указывает какое именно слово (или несколько) убрать:
{"action": "delete_words", "words": ["...", "..."]}

ПРАВИЛА:
- "words" — массив цинцкарских слов которые нужно удалить, кириллицей, в нижнем регистре, без знаков препинания.
- Извлекай только сами слова, не переводы.
- Максимум 10 слов за раз. Если просят больше — обрежь до 10.

🚫 ЗАПРЕЩЕНО — массовое удаление. Если пользователь просит "удали ВСЕ слова", "удали весь словарь", "очисти словарь", "удали всё на букву X", "удали все существительные", "удали ту половину" и любые другие массовые/общие удаления — НЕ возвращай action "delete_words". Вместо этого верни:
{"action": "reply", "message": "Массово удалить слова нельзя — это опасная операция. Если нужно удалить конкретные слова, перечисли их (до 10 за раз)."}

ВАРИАНТ 4 — ДОБАВИТЬ ФАКТ В ПАМЯТЬ БОТА. Выбирай этот вариант когда пользователь явно говорит "добавь в память", "запомни", "сохрани в памяти" и указывает что именно запомнить:
{"action": "add_memory", "text": "короткий факт или инструкция для памяти"}

ПРАВИЛА:
- "text" — только то, что нужно сохранить, без обращения "Бот"/"Баласи" и без команды "добавь в память".
- Не сохраняй пустой текст. Если пользователь не написал что именно запомнить — верни reply и спроси что добавить в память.
- Не используй add_memory для добавления слов в словарь, если пользователь явно говорит про слово и перевод.

ВАРИАНТ 5 — ОТВЕТИТЬ ПОЛЬЗОВАТЕЛЮ (всё остальное: вопросы, болтовня, приветствия, просьбы что-то рассказать или объяснить):
{"action": "reply", "message": "твой ответ"}

ПРАВИЛА для ответа:
- На русском, дружелюбно, по делу. Максимум 3-4 предложения. Для пересказов переписки можно до 6.
- Если спрашивают значение цинцкарского слова — ищи в словаре выше. Если слова там нет — честно скажи "такого слова в нашем словаре нет". НЕ выдумывай переводы цинцкарских слов из своей фантазии.
- Если просят перевести с русского на цинцкарский — ищи в словаре. Если нет — так и скажи.
- Если спрашивают о сохранённой памяти — используй раздел ПАМЯТЬ БОТА. Если памяти нет — скажи, что пока ничего не запомнил.
- Если спрашивают о недавней переписке ("о чём говорили", "что обсуждали", "перескажи", "кто что писал") — используй раздел НЕДАВНИЕ СООБЩЕНИЯ ниже. Отвечай обобщённо по темам, не цитируй дословно длинными кусками. Если переписки нет — скажи "нечего пересказывать".
- Если просят "рабочие ссылки" или ссылку на сайт — используй URL из ПАМЯТИ БОТА. Если URL не указан, скажи что ссылку ещё нужно добавить в память.
- На общие вопросы отвечай как обычный ассистент, но с учётом роли помощника Общества Цинцкаро: дружелюбно, полезно, без канцелярита.
- Если вопрос связан с Обществом Цинцкаро, наследием, встречами, сайтом, организацией, объявлениями или коммуникацией — помогай как координатор сообщества. Если не хватает фактов, честно скажи что нужно уточнить.
- Если непонятно что хочет пользователь — мягко переспроси.
${dictionarySection}${memorySection}${contextSection}
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

    if (parsed.action === 'update_words' && Array.isArray(parsed.entries)) {
      const entries: DictionaryUpdateInput[] = [];
      for (const raw of parsed.entries) {
        if (raw && typeof raw.oldWord === 'string' && raw.oldWord.trim()) {
          const newWord =
            typeof raw.newWord === 'string' && raw.newWord.trim()
              ? raw.newWord.toLowerCase().trim()
              : null;
          const translation =
            typeof raw.translation === 'string' && raw.translation.trim()
              ? raw.translation.trim()
              : null;
          const partOfSpeech =
            typeof raw.partOfSpeech === 'string' && raw.partOfSpeech.trim()
              ? raw.partOfSpeech.trim()
              : undefined;

          if (newWord || translation || partOfSpeech) {
            entries.push({
              oldWord: raw.oldWord.toLowerCase().trim(),
              newWord,
              translation,
              partOfSpeech,
            });
          }
        }
      }
      if (entries.length > 0) {
        return { action: 'update_words', entries };
      }
    }

    if (parsed.action === 'delete_words' && Array.isArray(parsed.words)) {
      const words = parsed.words
        .filter(
          (w: unknown): w is string =>
            typeof w === 'string' && w.trim().length > 0,
        )
        .map((w: string) => w.toLowerCase().trim());
      if (words.length > 0) {
        return { action: 'delete_words', words };
      }
    }

    if (parsed.action === 'add_memory' && typeof parsed.text === 'string') {
      const memoryText = parsed.text.trim();
      if (memoryText) {
        return { action: 'add_memory', text: memoryText };
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

  async normalizeDictionaryEntries(
    text: string,
  ): Promise<DictionaryEntryInput[]> {
    const prompt = `Ты помощник по подготовке словарных записей цинцкарского диалекта.

Пользователь прислал сообщение для добавления слов в словарь. Формат может быть неаккуратным: нет пробелов вокруг дефиса, вместо дефиса может быть двоеточие, слово и перевод могут быть просто через пробел, могут быть лишние вводные фразы.

Твоя задача — извлечь только явные пары "цинцкарское слово или фраза" + "русский перевод" и вернуть их в структурированном виде.

Правила:
- Не выдумывай слова и переводы. Если у строки нет понятного русского перевода, пропусти её.
- Не исправляй орфографию цинцкарского слова по догадке. Можно только убрать лишнюю пунктуацию и привести к нижнему регистру.
- Сохраняй несколько значений в переводе через запятую или точку с запятой, если они были в исходном тексте.
- Сохраняй пояснения в скобках.
- Игнорируй обращение к боту, команды, заголовки, просьбы, пустые строки, рейтинги и строки с @username.
- Если одна и та же пара повторяется, верни её один раз.

Ответь ТОЛЬКО валидным JSON:
{
  "entries": [
    {
      "word": "цинцкарское слово или фраза",
      "translation": "русский перевод",
      "partOfSpeech": null
    }
  ]
}

Сообщение:
"""
${text}
"""`;

    const response = await this.openai.chat.completions.create({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed.entries)) {
      return [];
    }

    const entries: DictionaryEntryInput[] = [];
    const seen = new Set<string>();
    for (const raw of parsed.entries) {
      if (
        !raw ||
        typeof raw.word !== 'string' ||
        typeof raw.translation !== 'string'
      ) {
        continue;
      }

      const word = raw.word
        .toLowerCase()
        .trim()
        .replace(/^[\s"'«»“”„`.,;:!?()[\]{}]+/g, '')
        .replace(/[\s"'«»“”„`.,;:!?()[\]{}]+$/g, '')
        .replace(/\s+/g, ' ');
      const translation = raw.translation
        .trim()
        .replace(/^[\s"'«»“”„`.,;:!?]+/g, '')
        .replace(/[\s"'«»“”„`.,;:!?]+$/g, '')
        .replace(/\s+/g, ' ');
      if (!word || !translation) continue;

      const partOfSpeech =
        typeof raw.partOfSpeech === 'string' && raw.partOfSpeech.trim()
          ? raw.partOfSpeech.trim()
          : null;
      const key = `${word}\u0000${translation}\u0000${partOfSpeech ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ word, translation, partOfSpeech });
    }

    return entries;
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
    messages: { text: string; username: string; ref?: string }[],
  ): Promise<ProcessDiscussionResult> {
    const formattedMessages = messages
      .map((m) => `${m.ref ? `[${m.ref}] ` : ''}[${m.username}]: ${m.text}`)
      .join('\n');

    const dictionary = await this.dictionaryService.getFormattedForPrompt();
    const dictionarySection = dictionary
      ? `\nИзвестные слова из словаря (предпочтительные переводы):\n${dictionary}\n`
      : '';

    const prompt = `Ты помощник по составлению словаря цинцкарского диалекта. Ниже — сообщения из Telegram-чата жителей села Цинцкаро. Они говорят по-русски и вставляют слова цинцкарского диалекта (смесь старого азербайджанского и восточно-анатолийского турецкого, записаны кириллицей).
${dictionarySection}
Твои задачи:
1. Написать очень короткое саммари обсуждения на русском: 2-4 коротких пункта или 2-3 коротких предложения. Только главное: темы, важные решения/разногласия и общий итог. Не перечисляй всех участников и не пересказывай чат подробно. Максимум 500 символов.
   - Не ставь символ @ перед именами пользователей.
   - Если важно кто написал, указывай username без @.
   - Если нужно сослаться на конкретную реплику, используй метку сообщения из списка: [m1], [m2] и т.п. Ставь не больше 1-3 таких ссылок на всё саммари.
2. Извлечь из чата ВСЕ предложенные слова цинцкарского диалекта. Для каждого указать: слово (кириллицей), перевод на русский, часть речи (сокращённо: сущ., гл., прил., межд. и т.д.), имя пользователя (username), кто это предложил или уточнил.

Если один и тот же вариант слова (слово + перевод + часть речи) повторяется несколькими людьми — всё равно выводи каждое вхождение отдельно (дубликаты будут удалены автоматически).
Если по одному слову разные участники дают разные переводы или части речи — выводи каждый вариант с указанием username.

Ответь ТОЛЬКО в формате JSON на русском:
{
  "discussionSummary": "Короткое саммари: 2-4 пункта или 2-3 коротких предложения, максимум 500 символов.",
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
