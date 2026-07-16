import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { DictionaryService } from '../dictionary/dictionary.service';
import { OpenaiUsagePurpose, OpenaiUsageService } from './openai-usage.service';

export interface ExtractedWord {
  word: string;
  possibleTranslation: string | null;
  context: string;
}

interface DiscussionAnalysisWord extends ExtractedWord {
  partOfSpeech: string | null;
  username: string | null;
}

/** Raw entry from chat: one suggestion per participant */
export interface ProcessDiscussionEntry {
  word: string;
  translation: string;
  partOfSpeech: string;
  username: string;
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

export interface DiscussionAnalysisResult {
  discussionSummary: string;
  words: ExtractedWord[];
  discussionResult: ProcessDiscussionResult;
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

export interface BotDictionaryContextEntry {
  word: string;
  translation: string;
  partOfSpeech?: string | null;
}

/** Result of processing a "Бот, ..." or "Баласи, ..." message */
export type BotMentionResult =
  | { action: 'add_words'; entries: DictionaryEntryInput[] }
  | { action: 'update_words'; entries: DictionaryUpdateInput[] }
  | { action: 'delete_words'; words: string[] }
  | { action: 'add_memory'; text: string }
  | { action: 'reply'; message: string };

const BOT_MENTION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'bot_mention_action',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          description: 'Ровно одно действие, соответствующее запросу.',
          enum: [
            'add_words',
            'update_words',
            'delete_words',
            'add_memory',
            'reply',
          ],
        },
        entries: {
          type: 'array',
          description:
            'Записи только для add_words или update_words; иначе пустой массив.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              word: { type: ['string', 'null'] },
              translation: { type: ['string', 'null'] },
              partOfSpeech: { type: ['string', 'null'] },
              oldWord: { type: ['string', 'null'] },
              newWord: { type: ['string', 'null'] },
            },
            required: [
              'word',
              'translation',
              'partOfSpeech',
              'oldWord',
              'newWord',
            ],
          },
        },
        words: {
          type: 'array',
          description:
            'Конкретные слова только для delete_words; иначе пустой массив.',
          items: { type: 'string' },
        },
        text: {
          type: ['string', 'null'],
          description:
            'Факт для сохранения только при action=add_memory; иначе null.',
        },
        message: {
          type: ['string', 'null'],
          description:
            'Непустой естественный ответ пользователю при action=reply; иначе null.',
        },
      },
      required: ['action', 'entries', 'words', 'text', 'message'],
    },
  },
} as const;

const BOT_REPLY_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'bot_reply',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: {
          type: 'string',
          description:
            'Непустой естественный ответ на текущую реплику пользователя.',
        },
      },
      required: ['message'],
    },
  },
} as const;

const BOT_ACTION_REQUEST_REGEX =
  /(?:^|[\s,.:;!?])(?:добав[а-яё]*|внес[а-яё]*|запиш[а-яё]*|сохран[а-яё]*|запомн[а-яё]*|исправ[а-яё]*|поправ[а-яё]*|обнов[а-яё]*|замен[а-яё]*|переимен[а-яё]*|удал[а-яё]*|убер[а-яё]*|сотр[а-яё]*)(?:$|[\s,.:;!?])/i;

const BOT_ORDINARY_QUESTION_REGEX =
  /[?？]\s*$|(?:^|[\s,.:;!])(?:кто|что|где|куда|откуда|когда|как|почему|зачем|сколько|како[йеяи]|чей|можно\s+ли|правда\s+ли|умеешь\s+ли)(?:$|[\s,.:;!?])/i;

const DICTIONARY_ENTRIES_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'dictionary_entries',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              word: { type: 'string' },
              translation: { type: 'string' },
              partOfSpeech: { type: ['string', 'null'] },
            },
            required: ['word', 'translation', 'partOfSpeech'],
          },
        },
      },
      required: ['entries'],
    },
  },
} as const;

const DISCUSSION_ANALYSIS_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'discussion_analysis',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        discussionSummary: { type: 'string' },
        words: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              word: { type: 'string' },
              possibleTranslation: { type: ['string', 'null'] },
              context: { type: 'string' },
              partOfSpeech: { type: ['string', 'null'] },
              username: { type: ['string', 'null'] },
            },
            required: [
              'word',
              'possibleTranslation',
              'context',
              'partOfSpeech',
              'username',
            ],
          },
        },
      },
      required: ['discussionSummary', 'words'],
    },
  },
} as const;

@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);
  private openai: OpenAI;
  private readonly botModel: string;
  private readonly extractionModel: string;
  private readonly reportModel: string;
  private readonly botMaxCompletionTokens: number;
  private readonly extractionMaxCompletionTokens: number;
  private readonly reportMaxCompletionTokens: number;

  constructor(
    private config: ConfigService,
    private dictionaryService: DictionaryService,
    private openaiUsageService: OpenaiUsageService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get('openaiKey'),
    });
    this.botModel = this.config.get<string>('openaiBotModel') || 'gpt-5.4-mini';
    this.extractionModel =
      this.config.get<string>('openaiExtractionModel') || 'gpt-5.4-nano';
    this.reportModel =
      this.config.get<string>('openaiReportModel') || 'gpt-5.4-mini';
    this.botMaxCompletionTokens =
      this.config.get<number>('openaiBotMaxCompletionTokens') || 800;
    this.extractionMaxCompletionTokens =
      this.config.get<number>('openaiExtractionMaxCompletionTokens') || 3000;
    this.reportMaxCompletionTokens =
      this.config.get<number>('openaiReportMaxCompletionTokens') || 4000;
  }

  async processBotMention(
    text: string,
    recentMessages: { username: string; text: string; sentAt: Date }[] = [],
    botMemory: BotMemoryInput[] = [],
    dictionaryEntries: BotDictionaryContextEntry[] = [],
  ): Promise<BotMentionResult> {
    const dictionarySection = dictionaryEntries.length
      ? `\nНАЙДЕННЫЕ СЛОВА В СЛОВАРЕ (используй для ответов на вопросы о значениях слов):\n${dictionaryEntries
          .map((e) => {
            const pos = e.partOfSpeech ? ` (${e.partOfSpeech})` : '';
            return `${e.word} = ${e.translation}${pos}`;
          })
          .join('\n')}\n`
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

    const actionSystemPrompt = `Ты помощник Общества Цинцкаро в Telegram-чате. Отвечай по-русски, дружелюбно и кратко.

Выбери одно действие:
- add_words — только когда пользователь явно просит добавить одну или несколько пар «цинцкарское слово — русский перевод»;
- update_words — когда явно просит исправить слово, написание или перевод;
- delete_words — только для перечисленных конкретных слов, максимум 10;
- add_memory — только при явной просьбе запомнить конкретный факт;
- reply — для вопросов, общения и всех остальных случаев.

Заполняй результат так:
- reply: обязательно запиши естественный непустой ответ в message;
- add_memory: запиши сохраняемый факт в text;
- delete_words: запиши конкретные слова в words;
- add_words и update_words: запиши данные в entries.
Во всех остальных полях возвращай пустой массив или null. Если запрос нельзя безопасно выполнить как действие, выбери reply и объясни это в message.

Для слов используй нижний регистр, не выдумывай переводы и сохраняй все явно указанные значения. Массовое удаление запрещено: выбери reply и напиши, что нужно перечислить до 10 конкретных слов.

В reply пиши 3–4 предложения, для пересказа — максимум 6. Для цинцкарских переводов используй только переданный словарь; если слова нет, честно скажи об этом. Для вопросов о памяти и переписке используй только соответствующие разделы контекста. Если фактов недостаточно, попроси уточнение.`;

    const userPrompt = `${dictionarySection}${memorySection}${contextSection}\nСООБЩЕНИЕ ПОЛЬЗОВАТЕЛЯ:\n${text}`;
    const contextMetadata = {
      userTextLength: text.length,
      recentMessages: recentMessages.length,
      memoryEntries: botMemory.length,
      dictionaryEntries: dictionaryEntries.length,
    };

    if (
      BOT_ORDINARY_QUESTION_REGEX.test(text) ||
      !BOT_ACTION_REQUEST_REGEX.test(text)
    ) {
      return this.createConversationalReply(
        text,
        userPrompt,
        contextMetadata,
        'conversation',
      );
    }

    const response = await this.createChatCompletion(
      'bot_mention',
      `Обращение к боту: ${text}`,
      {
        model: this.botModel,
        messages: [
          { role: 'system', content: actionSystemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: BOT_MENTION_RESPONSE_FORMAT,
        reasoning_effort: 'none',
        max_completion_tokens: this.botMaxCompletionTokens,
        prompt_cache_key: 'tsintskaro:bot_action:v3',
      },
      {
        ...contextMetadata,
        responseMode: 'action',
      },
    );

    const refusal = response.choices[0].message.refusal?.trim();
    if (refusal) {
      return { action: 'reply', message: refusal };
    }

    const parsed = this.parseJsonObject(
      response.choices[0].message.content || '',
    );
    if (!parsed) {
      return this.createConversationalReply(
        text,
        userPrompt,
        contextMetadata,
        'repair',
      );
    }

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

    if (parsed.action === 'reply') {
      const message = this.firstNonEmptyString(parsed.message, parsed.text);
      if (message) {
        return { action: 'reply', message };
      }
    }

    return this.createConversationalReply(
      text,
      userPrompt,
      contextMetadata,
      'repair',
    );
  }

  private async createConversationalReply(
    text: string,
    userPrompt: string,
    contextMetadata: Record<string, unknown>,
    responseMode: 'conversation' | 'repair',
  ): Promise<BotMentionResult> {
    const systemPrompt = `Ты Баласи, живой и внимательный помощник Общества Цинцкаро в Telegram-чате. Ответь непосредственно на текущую реплику по-русски, естественно и доброжелательно.

Отвечай на обычные вопросы на общие темы, объясняй понятия, помогай сформулировать текст и поддерживай разговор. Для простого вопроса или замечания обычно достаточно 1–4 предложений; если пользователь просит подробности, можно ответить развёрнуто. Не отвечай служебной фразой «не понял», если смысл реплики очевиден. Если вопрос требует свежих данных из интернета, которых нет во входе, не выдумывай актуальные факты.

Автоматические лайки и реакции бота отключены: просьбу не ставить лайки можно спокойно подтвердить. Не обещай изменить другие функции или код самостоятельно. Не утверждай, что запомнил факт навсегда, если он не передан в разделе памяти.

Используй историю, память и словарь только когда соответствующие разделы есть во входе. Для перевода цинцкарских слов опирайся только на переданный словарь; если данных нет, честно скажи об этом.`;
    const response = await this.createChatCompletion(
      'bot_mention',
      `${responseMode === 'repair' ? 'Восстановление ответа' : 'Ответ'} бота: ${text}`,
      {
        model: this.botModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: BOT_REPLY_RESPONSE_FORMAT,
        reasoning_effort: 'none',
        max_completion_tokens: this.botMaxCompletionTokens,
        prompt_cache_key: 'tsintskaro:bot_reply:v3',
      },
      { ...contextMetadata, responseMode },
    );

    const refusal = response.choices[0].message.refusal?.trim();
    if (refusal) {
      return { action: 'reply', message: refusal };
    }

    const parsed = this.parseJsonObject(
      response.choices[0].message.content || '',
    );
    const message = this.firstNonEmptyString(parsed?.message);
    if (message) {
      return { action: 'reply', message };
    }

    if (/(?:ты\s+тут|ты\s+здесь|на\s+связи)/i.test(text)) {
      return { action: 'reply', message: 'Да, я здесь и читаю сообщения.' };
    }
    if (/(?:лайк|реакци)[а-яё]*/i.test(text)) {
      return {
        action: 'reply',
        message: 'Понял, автоматические лайки и реакции отключены.',
      };
    }
    return {
      action: 'reply',
      message:
        'Я здесь, но сейчас не получилось сформировать ответ. Попробуй написать ещё раз.',
    };
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    try {
      const parsed: unknown = JSON.parse(content);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private firstNonEmptyString(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  async normalizeDictionaryEntries(
    text: string,
  ): Promise<DictionaryEntryInput[]> {
    const systemPrompt = `Извлеки из сообщения только явные пары «цинцкарское слово или фраза — русский перевод».

Не выдумывай и не исправляй написание по догадке. Убери только внешнюю пунктуацию, приведи слово к нижнему регистру, сохрани несколько значений и пояснения в скобках. Пропускай строки без понятного перевода, команды, заголовки, рейтинги и @username. Дубликаты верни один раз. Часть речи указывай только когда она явно дана или однозначна.`;

    const response = await this.createChatCompletion(
      'dictionary_normalization',
      `Разбор словарной записи: ${text}`,
      {
        model: this.extractionModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        response_format: DICTIONARY_ENTRIES_RESPONSE_FORMAT,
        reasoning_effort: 'none',
        max_completion_tokens: this.extractionMaxCompletionTokens,
      },
      { textLength: text.length },
    );

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

  async analyzeDiscussion(
    messages: { text: string; username: string; ref?: string }[],
  ): Promise<DiscussionAnalysisResult> {
    const formattedMessages = messages
      .map((m) => `${m.ref ? `[${m.ref}] ` : ''}[${m.username}]: ${m.text}`)
      .join('\n');
    const relevantDictionary =
      await this.dictionaryService.findRelevantForPrompt(
        messages.map((message) => message.text),
        100,
      );
    const dictionary =
      this.dictionaryService.formatEntriesForPrompt(relevantDictionary);
    const dictionarySection = dictionary
      ? `ИЗВЕСТНЫЕ СЛОВА ИЗ СЛОВАРЯ:\n${dictionary}\n\n`
      : '';

    const systemPrompt = `Проанализируй сообщения русскоязычного Telegram-чата жителей села Цинцкаро. Они используют цинцкарский диалект — смесь старого азербайджанского и восточно-анатолийского турецкого, записанную кириллицей.

Сделай короткое саммари обсуждения: 2–4 пункта или 2–3 предложения, максимум 500 символов. Упомяни только главные темы, решения и разногласия. Не ставь @ перед именами. Можно использовать не более трёх ссылок вида [m1].

Найди все слова, не являющиеся стандартным русским языком. Для каждого верни короткий контекст, часть речи и автора. Если слово присутствует в переданном словаре, используй только словарный перевод. Для неизвестного слова попробуй определить перевод по контексту, иначе верни null. Если участники предлагают разные переводы или части речи, верни каждый вариант отдельным элементом.`;
    const userPrompt = `${dictionarySection}СООБЩЕНИЯ:\n${formattedMessages}`;

    const response = await this.createChatCompletion(
      'discussion_report',
      `Единый отчёт по обсуждению: ${messages.length} сообщений`,
      {
        model: this.reportModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: DISCUSSION_ANALYSIS_RESPONSE_FORMAT,
        reasoning_effort: 'none',
        max_completion_tokens: this.reportMaxCompletionTokens,
      },
      {
        messagesCount: messages.length,
        dictionaryEntries: relevantDictionary.length,
        dictionaryTextLength: dictionary.length,
        formattedMessagesLength: formattedMessages.length,
      },
    );

    const content = response.choices[0].message.content || '{}';
    const parsed = JSON.parse(content) as {
      discussionSummary?: unknown;
      words?: unknown;
    };
    const rawWords = Array.isArray(parsed.words) ? parsed.words : [];
    const analyzedWords: DiscussionAnalysisWord[] = rawWords
      .filter(
        (raw): raw is Record<string, unknown> =>
          Boolean(raw) &&
          typeof raw === 'object' &&
          typeof (raw as Record<string, unknown>).word === 'string',
      )
      .map((raw) => ({
        word: String(raw.word).trim(),
        possibleTranslation:
          typeof raw.possibleTranslation === 'string' &&
          raw.possibleTranslation.trim()
            ? raw.possibleTranslation.trim()
            : null,
        context: typeof raw.context === 'string' ? raw.context.trim() : '',
        partOfSpeech:
          typeof raw.partOfSpeech === 'string' && raw.partOfSpeech.trim()
            ? raw.partOfSpeech.trim()
            : null,
        username:
          typeof raw.username === 'string' && raw.username.trim()
            ? raw.username.trim().replace(/^@/, '')
            : null,
      }))
      .filter((word) => word.word.length > 0);

    const discussionEntries: ProcessDiscussionEntry[] = analyzedWords
      .filter(
        (
          word,
        ): word is DiscussionAnalysisWord & {
          possibleTranslation: string;
        } => Boolean(word.possibleTranslation),
      )
      .map((word) => ({
        word: word.word,
        translation: word.possibleTranslation,
        partOfSpeech: word.partOfSpeech ?? '',
        username: word.username ?? 'unknown',
      }));
    const { agreedWords, disputedWords, duplicatesRemoved } =
      this.deduplicateAndSplit(discussionEntries);
    const discussionSummary =
      typeof parsed.discussionSummary === 'string' &&
      parsed.discussionSummary.trim()
        ? parsed.discussionSummary.trim()
        : 'Подробное описание не сформировано.';

    return {
      discussionSummary,
      words: analyzedWords.map(({ word, possibleTranslation, context }) => ({
        word,
        possibleTranslation,
        context,
      })),
      discussionResult: {
        discussionSummary,
        agreedWords,
        disputedWords,
        totalExtracted: analyzedWords.length,
        duplicatesRemoved,
      },
    };
  }

  async analyzeMessages(messages: string[]): Promise<ExtractedWord[]> {
    const result = await this.analyzeDiscussion(
      messages.map((text, index) => ({
        text,
        username: 'unknown',
        ref: `m${index + 1}`,
      })),
    );
    return result.words;
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

    const response = await this.createChatCompletion(
      'list_compilation',
      `Составление обновлённого списка: ${messages.length} сообщений`,
      {
        model: this.reportModel,
        messages: [{ role: 'user', content: prompt }],
        reasoning_effort: 'none',
        max_completion_tokens: this.reportMaxCompletionTokens,
      },
      { messagesCount: messages.length },
    );

    return response.choices[0].message.content || 'Ошибка обработки';
  }

  /**
   * Обрабатывает обсуждение: извлекает слова, убирает точные дубликаты,
   * объединяет разные мнения в комментарии. Весь текст — на русском.
   */
  async processDiscussion(
    messages: { text: string; username: string; ref?: string }[],
  ): Promise<ProcessDiscussionResult> {
    const result = await this.analyzeDiscussion(messages);
    return result.discussionResult;
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

  private async createChatCompletion(
    purpose: OpenaiUsagePurpose,
    detail: string,
    params: ChatCompletionCreateParamsNonStreaming,
    metadata: Record<string, unknown> = {},
  ): Promise<ChatCompletion> {
    const requestParams: ChatCompletionCreateParamsNonStreaming = {
      ...params,
      prompt_cache_key: params.prompt_cache_key ?? `tsintskaro:${purpose}:v2`,
    };
    const response = await this.openai.chat.completions.create(requestParams);
    try {
      await this.openaiUsageService.record({
        purpose,
        detail,
        model: response.model || String(requestParams.model),
        usage: response.usage,
        metadata: {
          ...metadata,
          inputTextLength: this.getMessagesTextLength(requestParams.messages),
          reasoningEffort: requestParams.reasoning_effort ?? null,
          maxCompletionTokens: requestParams.max_completion_tokens ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to record OpenAI usage: ${err}`);
    }
    return response;
  }

  private getMessagesTextLength(
    messages: ChatCompletionCreateParamsNonStreaming['messages'],
  ): number {
    let total = 0;
    for (const message of messages) {
      if (typeof message.content === 'string') {
        total += message.content.length;
        continue;
      }
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content as Array<{ text?: unknown }>) {
        if (typeof part.text === 'string') total += part.text.length;
      }
    }
    return total;
  }
}
