import {
  Action,
  Update,
  Ctx,
  Hears,
  Command,
  Start,
  InjectBot,
} from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { BotMemoryEntry, TelegramService } from './telegram.service';
import {
  DictionaryEntry,
  DictionaryService,
} from '../dictionary/dictionary.service';
import {
  BotDictionaryContextEntry,
  DictionaryEntryInput,
  DictionaryUpdateInput,
  OpenaiService,
} from '../openai/openai.service';
import {
  OpenaiUsageService,
  OPENAI_USAGE_REPORT_TIME_ZONE,
} from '../openai/openai-usage.service';
import { PollConfigService } from '../poll/poll-config.service';
import { PollSchedulerService } from '../poll/poll-scheduler.service';
import {
  DEFAULT_WORD_REVIEW_LIMIT,
  WordReviewService,
} from '../word-review/word-review.service';
import { FactDayConfigService } from '../fact-day/fact-day-config.service';
import {
  FACT_DAY_SCHEDULE_LABEL,
  FactDaySchedulerService,
} from '../fact-day/fact-day-scheduler.service';
import { ConfigService } from '@nestjs/config';
import { Logger, OnModuleInit } from '@nestjs/common';

interface SpellingCorrectionByTranslation {
  newWord: string;
  translation: string;
}

@Update()
export class TelegramUpdate implements OnModuleInit {
  private readonly threshold: number;
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly reportOpenAiUnavailableNotifiedChats = new Set<number>();

  constructor(
    @InjectBot() private bot: Telegraf<Context>,
    private telegramService: TelegramService,
    private openaiService: OpenaiService,
    private dictionaryService: DictionaryService,
    private pollConfigService: PollConfigService,
    private pollScheduler: PollSchedulerService,
    private factDayConfigService: FactDayConfigService,
    private factDayScheduler: FactDaySchedulerService,
    private wordReviewService: WordReviewService,
    private openaiUsageService: OpenaiUsageService,
    private config: ConfigService,
  ) {
    this.threshold = this.config.get('messageThreshold') || 100;
    this.logger.log(`Bot initialized with threshold: ${this.threshold}`);
  }

  async onModuleInit() {
    await this.bot.telegram.setMyCommands([
      { command: 'start', description: 'Начать работу' },
      { command: 'report', description: 'Создать отчёт сейчас' },
      { command: 'status', description: 'Показать количество сообщений' },
      { command: 'clear', description: 'Очистить буфер без отчёта' },
      { command: 'setsummarythread', description: 'Слать отчёты в этот топик' },
      { command: 'clearsummarythread', description: 'Отключить топик отчётов' },
      {
        command: 'summarythreadstatus',
        description: 'Куда сейчас идут отчёты',
      },
      { command: 'setpollchat', description: 'Слать опросы в этот топик' },
      { command: 'clearpollchat', description: 'Отключить опросы' },
      { command: 'pollstatus', description: 'Куда сейчас идут опросы' },
      { command: 'pollnow', description: 'Отправить пару опросов сейчас' },
      {
        command: 'settokenreport',
        description: 'Слать ежедневный отчёт по OpenAI токенам сюда',
      },
      {
        command: 'cleartokenreport',
        description: 'Отключить ежедневный отчёт по токенам',
      },
      {
        command: 'tokenreport',
        description: 'Показать отчёт по OpenAI токенам за сегодня',
      },
      {
        command: 'setreviewchat',
        description: 'Слать слова на проверку в этот топик',
      },
      {
        command: 'clearreviewchat',
        description: 'Отключить проверку словаря',
      },
      {
        command: 'reviewstatus',
        description: 'Статус проверки словаря',
      },
      {
        command: 'reviewnow',
        description: 'Отправить слова на проверку сейчас',
      },
      { command: 'rules', description: 'Правила цинцкарского языка' },
      { command: 'leaderboard', description: 'Топ добавивших слова' },
      {
        command: 'startfactday',
        description: 'Запустить исторический квиз в этом топике',
      },
      { command: 'stopfactday', description: 'Отключить исторический квиз' },
      {
        command: 'factdaystatus',
        description: 'Куда сейчас идёт исторический квиз',
      },
      {
        command: 'factdaynow',
        description: 'Отправить исторический квиз сейчас',
      },
      { command: 'memory', description: 'Показать память бота' },
      { command: 'memoryadd', description: 'Добавить запись в память' },
      { command: 'memoryedit', description: 'Изменить запись памяти' },
      { command: 'memorydel', description: 'Удалить запись памяти' },
      { command: 'threadid', description: 'Показать chat_id и thread_id' },
    ]);
    this.logger.log('Bot commands registered');
    await this.telegramService.ensureDefaultGlobalMemory();
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    this.logger.log('Received /start command');
    await ctx.reply(
      'გამარჯობა! Я бот-словарь Цинцкаро.\n\n' +
        'Я собираю сообщения и нахожу нерусские слова для словаря.\n\n' +
        'Команды:\n' +
        '/report - Создать отчёт сейчас\n' +
        '/status - Показать количество собранных сообщений\n' +
        '/clear - Очистить буфер без отчёта\n' +
        '/setsummarythread - Слать отчёты в этот топик\n' +
        '/settokenreport - Слать ежедневный отчёт по OpenAI токенам сюда\n' +
        '/tokenreport - Показать расход OpenAI токенов за сегодня\n' +
        '/startfactday - Запустить исторический квиз в этом топике\n' +
        '/rules - Правила цинцкарского языка\n' +
        '/leaderboard - Топ добавивших слова\n' +
        '/memory - Память бота',
    );
  }

  private isPrivateChat(ctx: Context): boolean {
    return ctx.chat?.type === 'private';
  }

  private async isAdmin(
    ctx: Context,
    username: string | undefined,
  ): Promise<boolean> {
    if (username === 'AAlxnv' || username === 'MEMazmanova') {
      return true;
    }

    const chatId = ctx.chat?.id;
    const userId = ctx.from?.id;
    if (!chatId || !userId) {
      return false;
    }

    try {
      const member = await ctx.telegram.getChatMember(chatId, userId);
      return member.status === 'creator' || member.status === 'administrator';
    } catch (err) {
      this.logger.warn(
        `[Chat ${chatId}] Failed to check Telegram admin status for @${username ?? 'unknown'}: ${err}`,
      );
      return false;
    }
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const admin = await this.isAdmin(ctx, ctx.from?.username);
    if (!admin) {
      await ctx.reply('Команды боту доступны только администраторам');
    }
    return admin;
  }

  @Hears(/^[^\/]/)
  async onText(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) return;
    if (ctx.from?.is_bot) return; // Игнорировать сообщения от ботов

    const chatId = ctx.chat!.id;
    const message = ctx.message as {
      message_id?: number;
      text: string;
      from?: {
        id?: number;
        username?: string;
        first_name?: string;
        last_name?: string;
      };
      message_thread_id?: number;
      date?: number;
      reply_to_message?: { message_id?: number };
    };
    const text = message.text;
    const threadId = message.message_thread_id;
    const username = message.from?.username || 'anonymous';

    const replyToMessageId = message.reply_to_message?.message_id;
    const userId = message.from?.id;
    if (replyToMessageId && userId) {
      const correction = await this.wordReviewService.handleCorrectionReply({
        chatId,
        userId,
        username: message.from?.username ?? null,
        replyToMessageId,
        text,
      });
      if (correction.status !== 'not_correction') {
        if (correction.message) {
          await ctx.reply(correction.message, {
            reply_parameters: { message_id: message.message_id! },
          });
        }
        return;
      }
    }

    if (TelegramUpdate.BOT_MENTION_REGEX.test(text)) {
      await this.handleBotMention(
        ctx,
        text,
        username,
        message.message_id,
        threadId ?? null,
      );
      return;
    }

    this.logger.log(
      `[Chat ${chatId}${threadId ? ` / thread ${threadId}` : ''}] Received text: "${text}"`,
    );

    const sentAt = message.date ? new Date(message.date * 1000) : new Date();
    const count = await this.telegramService.addMessage(
      chatId,
      threadId ?? null,
      message.message_id ?? null,
      text,
      username,
      sentAt,
    );
    this.logger.log(
      `[Chat ${chatId}] Message count: ${count}/${this.threshold}`,
    );

    if (count >= this.threshold) {
      await this.generateReport(ctx);
    }
  }

  @Action(/^wr:(?:correct|fix):\d+:\d+$/)
  async onWordReviewAction(@Ctx() ctx: Context) {
    const callback = ctx.callbackQuery as
      | { data?: string; from?: { id?: number; username?: string } }
      | undefined;
    const data = callback?.data;
    const userId = ctx.from?.id ?? callback?.from?.id;
    const chatId = ctx.chat?.id;
    if (!data || !userId || !chatId) {
      await ctx.answerCbQuery('Не получилось обработать ответ.');
      return;
    }

    const firstName = ctx.from?.first_name?.trim() ?? '';
    const lastName = ctx.from?.last_name?.trim() ?? '';
    const displayName = ctx.from?.username
      ? `@${ctx.from.username}`
      : [firstName, lastName].filter(Boolean).join(' ') || 'Участник';

    try {
      const result = await this.wordReviewService.handleAction({
        data,
        chatId,
        userId,
        username: ctx.from?.username ?? null,
        displayName,
      });
      await ctx.answerCbQuery(result.message || 'Ответ записан.');
    } catch (error) {
      this.logger.error('Word review button failed', error);
      await ctx.answerCbQuery('Ошибка. Попробуйте ещё раз.');
    }
  }

  private static readonly BOT_MENTION_REGEX = /^\s*(?:бот|баласи)[\s,:!.\-—]/i;
  private static readonly MAX_DELETE_BATCH = 10;
  private static readonly MAX_UPDATE_BATCH = 5;

  private static readonly BOT_CONTEXT_SUMMARY_MESSAGE_LIMIT = 50;

  private static readonly BOT_CONTEXT_MAX_CHARS = 12000;

  private static readonly BOT_MEMORY_LIMIT = 50;

  private static readonly BOT_DICTIONARY_CONTEXT_LIMIT = 5;

  private static readonly WORKING_LINKS_REQUEST_REGEX =
    /(?:рабоч\w*\s+ссыл|ссылк\w*[\s\S]{0,40}рабоч|скин\w*[\s\S]{0,40}ссыл|пришл\w*[\s\S]{0,40}ссыл|дай[\s\S]{0,40}ссыл)/i;

  private static readonly RECENT_MESSAGES_CONTEXT_REGEX =
    /(?:о\s+ч[её]м[\s\S]{0,30}(?:говор|пис|общал)|что[\s\S]{0,30}(?:обсужда|писал)|перескаж|переписк|недавн\w*\s+сообщ|последн\w*\s+сообщ|кто[\s\S]{0,30}писал|выше\s+(?:писал|говорил)|истори\w*\s+чат)/i;

  private static readonly BOT_MEMORY_CONTEXT_REGEX =
    /(?:памят|запомн|общество|цинцкар|наслед|истори\w*\s+сел|сайт|ссыл|встреч|мероприят|проект|организац|правил\w*\s+(?:язык|диалект|слов))/i;

  private static readonly LEADERBOARD_REQUEST_REGEX =
    /(?:(?:^|[\s,.:;!?])(?:покажи|показать|пришли|прислать|дай|выведи|вывести|скинь|отправь|хочу|нужен|нужна)(?:$|[\s,.:;!?])[\s\S]{0,40}(?:лидер|топ|рейтинг|таблиц\w*\s+лидер)|(?:^|[\s,.:;!?])(?:лидер|топ|рейтинг)(?:$|[\s,.:;!?])[\s\S]{0,40}(?:^|[\s,.:;!?])(?:покажи|показать|пришли|прислать|дай|выведи|вывести|скинь|отправь)(?:$|[\s,.:;!?])|кто\s+(?:больше|больше\s+всех|больше\s+всего|много)[\s\S]{0,40}(?:слов|слова|добав)|кто[\s\S]{0,40}(?:добавил|добавляет)[\s\S]{0,40}(?:слов|слова))/i;

  private static readonly URL_REGEX =
    /https?:\/\/[^\s<>()"']*[A-Za-z0-9-]+\.[A-Za-z]{2,}[^\s<>()"']*/i;

  private async handleBotMention(
    ctx: Context,
    text: string,
    username: string,
    messageId: number | undefined,
    threadId: number | null,
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] @${username} addressed bot: "${text}"`);

    const directMemoryText = this.extractBotMemoryText(text);
    if (directMemoryText != null) {
      await this.saveBotMemory(
        ctx,
        chatId,
        threadId,
        username,
        messageId,
        directMemoryText,
      );
      return;
    }

    const spellingCorrection =
      await this.extractSpellingCorrectionByTranslation(text);
    if (spellingCorrection) {
      await this.handleSpellingCorrectionByTranslation(
        ctx,
        chatId,
        username,
        messageId,
        spellingCorrection,
      );
      return;
    }

    const directDictionaryUpdate = this.extractDirectDictionaryUpdate(text);
    if (directDictionaryUpdate) {
      await this.handleDictionaryUpdates(ctx, chatId, username, messageId, [
        directDictionaryUpdate,
      ]);
      return;
    }

    const directDictionaryEntries = await this.extractDirectDictionaryEntries(
      text,
      chatId,
    );
    if (directDictionaryEntries.length > 0) {
      await this.handleDictionaryAdditions(
        ctx,
        chatId,
        username,
        messageId,
        directDictionaryEntries,
      );
      return;
    }

    if (this.isLeaderboardRequest(text)) {
      await this.replyWithLeaderboard(ctx, messageId);
      return;
    }

    if (await this.replyToDictionaryLookup(ctx, text, messageId)) {
      return;
    }

    if (this.isWorkingLinksRequest(text)) {
      const botMemory = await this.telegramService.getBotMemory(
        chatId,
        TelegramUpdate.BOT_MEMORY_LIMIT,
      );
      await this.replyWithWorkingLinks(ctx, messageId, botMemory);
      return;
    }

    const needsRecentMessages = this.needsRecentMessagesContext(text);
    const needsBotMemory = this.needsBotMemoryContext(text);
    const [loadedRecentMessages, botMemory, dictionaryEntries] =
      await Promise.all([
        needsRecentMessages
          ? this.telegramService.getRecentMessages(
              chatId,
              threadId,
              TelegramUpdate.BOT_CONTEXT_SUMMARY_MESSAGE_LIMIT,
            )
          : Promise.resolve([]),
        needsBotMemory
          ? this.telegramService.getBotMemory(
              chatId,
              TelegramUpdate.BOT_MEMORY_LIMIT,
            )
          : Promise.resolve([]),
        this.getDictionaryContextEntries(text),
      ]);
    const recentMessages = this.limitRecentMessagesByChars(
      loadedRecentMessages,
      TelegramUpdate.BOT_CONTEXT_MAX_CHARS,
    );
    this.logger.log(
      `[Chat ${chatId}] Loaded ${recentMessages.length} recent messages, ${botMemory.length} memory entries and ${dictionaryEntries.length} dictionary entries for AI context`,
    );

    let result;
    try {
      result = await this.openaiService.processBotMention(
        text,
        recentMessages,
        botMemory,
        dictionaryEntries,
      );
    } catch (err) {
      this.logger.error(`[Chat ${chatId}] AI processBotMention failed:`, err);
      if (messageId != null) {
        await ctx.reply(
          'Не получилось обработать сообщение, попробуй ещё раз.',
          {
            reply_parameters: { message_id: messageId },
          },
        );
      }
      return;
    }

    if (result.action === 'reply') {
      this.logger.log(`[Chat ${chatId}] AI reply: ${result.message}`);
      if (messageId != null) {
        await ctx.reply(result.message, {
          reply_parameters: { message_id: messageId },
        });
      }
      return;
    }

    if (result.action === 'add_memory') {
      await this.saveBotMemory(
        ctx,
        chatId,
        threadId,
        username,
        messageId,
        result.text,
      );
      return;
    }

    if (result.action === 'update_words') {
      await this.handleDictionaryUpdates(
        ctx,
        chatId,
        username,
        messageId,
        result.entries,
      );
      return;
    }

    if (result.action === 'delete_words') {
      if (!(await this.isAdmin(ctx, username))) {
        this.logger.log(
          `[Chat ${chatId}] Non-admin @${username} tried to delete: ${result.words.join(', ')}`,
        );
        if (messageId != null) {
          await ctx.reply(
            '🚫 Удалять слова из словаря могут только администраторы.',
            {
              reply_parameters: { message_id: messageId },
            },
          );
        }
        return;
      }

      if (result.words.length > TelegramUpdate.MAX_DELETE_BATCH) {
        this.logger.warn(
          `[Chat ${chatId}] @${username} delete batch too big: ${result.words.length} words — refused`,
        );
        if (messageId != null) {
          await ctx.reply(
            `🚫 Нельзя удалить больше ${TelegramUpdate.MAX_DELETE_BATCH} слов за один раз. Перечисли меньше слов или удаляй по частям.`,
            { reply_parameters: { message_id: messageId } },
          );
        }
        return;
      }

      try {
        const { deleted, notFound } = await this.dictionaryService.deleteWords(
          result.words,
        );
        this.logger.log(
          `[Chat ${chatId}] Admin @${username} deleted: [${deleted.join(', ')}], notFound: [${notFound.join(', ')}]`,
        );

        if (messageId != null) {
          const lines: string[] = [];
          if (deleted.length > 0) {
            lines.push(
              deleted.length === 1
                ? '🗑 удалил:'
                : `🗑 удалил (${deleted.length}):`,
            );
            for (const w of deleted) lines.push(`• ${w}`);
          }
          if (notFound.length > 0) {
            if (lines.length > 0) lines.push('');
            lines.push(`⚠️ нет в словаре: ${notFound.join(', ')}`);
          }
          if (lines.length === 0) {
            lines.push('Нечего удалять.');
          }

          await ctx.reply(lines.join('\n'), {
            reply_parameters: { message_id: messageId },
          });
        }
      } catch (err) {
        this.logger.error(`[Chat ${chatId}] deleteWords failed:`, err);
        if (messageId != null) {
          await ctx.reply('Ошибка при удалении слов из словаря.', {
            reply_parameters: { message_id: messageId },
          });
        }
      }
      return;
    }

    // action === 'add_words'
    await this.handleDictionaryAdditions(
      ctx,
      chatId,
      username,
      messageId,
      result.entries,
    );
  }

  private async extractDirectDictionaryEntries(
    text: string,
    chatId: number,
  ): Promise<DictionaryEntryInput[]> {
    const body = text.replace(TelegramUpdate.BOT_MENTION_REGEX, '').trim();
    const localEntries = this.extractDirectDictionaryEntriesLocally(body);

    if (!this.shouldUseAiDictionaryParser(body, localEntries)) {
      return localEntries;
    }

    try {
      const aiEntries =
        await this.openaiService.normalizeDictionaryEntries(body);
      if (aiEntries.length > localEntries.length) {
        this.logger.log(
          `[Chat ${chatId}] AI dictionary parser extracted ${aiEntries.length} entries instead of ${localEntries.length}`,
        );
        return this.deduplicateDictionaryEntries(aiEntries);
      }
    } catch (err) {
      this.logger.warn(
        `[Chat ${chatId}] AI dictionary parser failed, using local parser result: ${err}`,
      );
    }

    return localEntries;
  }

  private extractDirectDictionaryEntriesLocally(
    body: string,
  ): DictionaryEntryInput[] {
    const entries: DictionaryEntryInput[] = [];
    const seen = new Set<string>();

    for (const line of this.splitDictionaryEntryLines(body)) {
      const entry = this.extractDictionaryEntryLine(line);
      if (!entry) continue;

      const key = `${entry.word}\u0000${entry.translation}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }

    if (!this.hasDictionaryAddIntent(body) && entries.length < 3) {
      return [];
    }

    return entries;
  }

  private async extractSpellingCorrectionByTranslation(
    text: string,
  ): Promise<SpellingCorrectionByTranslation | null> {
    const body = text
      .replace(TelegramUpdate.BOT_MENTION_REGEX, '')
      .trim()
      .replace(/\s+/g, ' ');

    const match = body.match(
      /^(?:измени|исправь|поправь|обнови)\s+(?:правописани[ея]|написани[ея]|орфографи[юя])\s+(?:слова?\s+)?(.+?)\s*(?:=|—|-|:)\s*(.+?)[.!?]*$/i,
    );
    if (!match) return null;

    const newWord = this.cleanDictionaryWord(match[1]);
    const translation = this.cleanDictionaryTranslation(match[2]);
    if (!newWord || !translation || !this.isLikelyDictionaryWord(newWord)) {
      return null;
    }

    return { newWord, translation };
  }

  private async handleSpellingCorrectionByTranslation(
    ctx: Context,
    chatId: number,
    username: string,
    messageId: number | undefined,
    correction: SpellingCorrectionByTranslation,
  ): Promise<void> {
    const matches = await this.dictionaryService.findByTranslation(
      correction.translation,
    );

    if (matches.length === 1) {
      await this.handleDictionaryUpdates(ctx, chatId, username, messageId, [
        {
          oldWord: matches[0].word,
          newWord: correction.newWord,
          translation: correction.translation,
        },
      ]);
      return;
    }

    if (messageId == null) return;

    if (matches.length === 0) {
      await ctx.reply(
        `⚠️ не нашёл в словаре слово с переводом «${correction.translation}». Не стал создавать новую запись.`,
        { reply_parameters: { message_id: messageId } },
      );
      return;
    }

    const candidates = matches
      .slice(0, 5)
      .map((entry) => entry.word)
      .join(', ');
    await ctx.reply(
      `⚠️ нашёл несколько слов с переводом «${correction.translation}»: ${candidates}. Напиши старое слово явно: «Баласи, исправь старое_слово на ${correction.newWord}».`,
      { reply_parameters: { message_id: messageId } },
    );
  }

  private async replyToDictionaryLookup(
    ctx: Context,
    text: string,
    messageId: number | undefined,
  ): Promise<boolean> {
    if (!this.isDictionaryLookupRequest(text)) {
      return false;
    }

    const candidates = this.extractDictionaryLookupCandidates(text);
    if (candidates.length === 0) {
      return false;
    }

    const isExistenceRequest = this.isDictionaryExistenceRequest(text);
    const entries = await this.findDictionaryLookupEntries(
      candidates,
      this.isRussianToTsintskaroLookupRequest(text),
      isExistenceRequest,
    );
    const message =
      entries.length > 0
        ? this.formatDictionaryLookupReply(
            entries,
            candidates,
            isExistenceRequest,
          )
        : this.formatMissingDictionaryLookupReply(candidates);

    if (messageId != null) {
      await ctx.reply(message, {
        reply_parameters: { message_id: messageId },
      });
      return true;
    }

    await ctx.reply(message);
    return true;
  }

  private async getDictionaryContextEntries(
    text: string,
  ): Promise<BotDictionaryContextEntry[]> {
    const candidates = this.extractDictionaryLookupCandidates(text);
    if (candidates.length === 0) {
      return [];
    }

    const entries = await this.findDictionaryLookupEntries(
      candidates,
      this.isRussianToTsintskaroLookupRequest(text),
    );

    return entries.map((entry) => ({
      word: entry.word,
      translation: entry.translation,
      partOfSpeech: entry.partOfSpeech,
    }));
  }

  private async findDictionaryLookupEntries(
    candidates: string[],
    reverseLookup: boolean,
    searchBothDirections = false,
  ): Promise<DictionaryEntry[]> {
    const entries: DictionaryEntry[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates.slice(0, 8)) {
      const found: DictionaryEntry[] = [];

      if (!reverseLookup || searchBothDirections) {
        const directMatch = await this.dictionaryService.findWord(candidate);
        if (directMatch) found.push(directMatch);
      }
      if (reverseLookup || searchBothDirections) {
        found.push(
          ...(await this.dictionaryService.findByTranslation(candidate)),
        );
      }

      for (const entry of found) {
        const key = entry.word.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(entry);
        if (entries.length >= TelegramUpdate.BOT_DICTIONARY_CONTEXT_LIMIT) {
          return entries;
        }
      }
    }

    return entries;
  }

  private formatDictionaryLookupReply(
    entries: DictionaryEntry[],
    candidates: string[],
    isExistenceRequest: boolean,
  ): string {
    const heading = isExistenceRequest
      ? entries.length === 1
        ? `Да, нашёл в словаре запись для «${candidates.join(', ')}»:`
        : `Да, нашёл в словаре ${entries.length} подходящих записей для «${candidates.join(', ')}»:`
      : entries.length === 1
        ? 'Нашёл в словаре:'
        : `Нашёл в словаре ${entries.length} подходящих записей:`;

    const details = entries.map((entry, index) => {
      const lines = [
        `Слово: ${entry.word}`,
        `Перевод: ${entry.translation}`,
        `Часть речи: ${entry.partOfSpeech || 'не указана'}`,
      ];

      const source = this.formatDictionarySource(entry.source);
      if (source) lines.push(`Источник: ${source}`);
      if (entry.comments?.trim()) {
        lines.push(`Примечание: ${entry.comments.trim()}`);
      }

      if (entries.length === 1) return lines.join('\n');
      return `${index + 1}. ${lines.join('\n   ')}`;
    });

    return [heading, ...details].join('\n\n');
  }

  private formatMissingDictionaryLookupReply(candidates: string[]): string {
    const label = candidates.map((candidate) => `«${candidate}»`).join(', ');
    return `Проверил ${label}: в нашем словаре точного совпадения пока нет. Проверь написание слова или уточни, нужен поиск по цинцкарскому слову или по русскому переводу.`;
  }

  private formatDictionarySource(
    source: DictionaryEntry['source'],
  ): string | null {
    if (source === 'etalon') return 'эталонный словарь';
    if (source === 'rabochy') return 'рабочий словарь';
    if (source === 'chat') return 'добавлено участниками чата';
    return null;
  }

  private isDictionaryLookupRequest(text: string): boolean {
    return (
      /(?:как\s+перевести|переведи|что\s+(?:значит|означает)|значение\s+слова|перевод\s+слова|на\s+русский|на\s+цинцкарск|по-цинцкарск)/i.test(
        text,
      ) || this.isDictionaryExistenceRequest(text)
    );
  }

  private isDictionaryExistenceRequest(text: string): boolean {
    return /(?:есть\s+ли[^?.!]*словар|в\s+(?:нашем\s+)?словаре\s+(?:есть|имеется)|(?:есть|имеется)[^?.!]*в\s+(?:нашем\s+)?словаре|(?:проверь|посмотри|найди|поищи)[^?.!]*\bсловар)/i.test(
      text,
    );
  }

  private isRussianToTsintskaroLookupRequest(text: string): boolean {
    return /(?:на\s+цинцкарск|по-цинцкарск)/i.test(text);
  }

  private extractDictionaryLookupCandidates(text: string): string[] {
    const body = text
      .replace(TelegramUpdate.BOT_MENTION_REGEX, '')
      .trim()
      .replace(/\s+/g, ' ');
    const candidates: string[] = [];

    const quoted = /[«"“„](.+?)[»"”]/g;
    for (const match of body.matchAll(quoted)) {
      this.addDictionaryLookupCandidate(candidates, match[1]);
    }

    const patterns = [
      /(?:как\s+перевести(?:\s+на\s+(?:русский|цинцкарский))?|переведи(?:\s+на\s+(?:русский|цинцкарский))?)\s+(.+?)(?:[?.!]|$)/i,
      /(?:что\s+(?:значит|означает)|значение\s+слова|перевод\s+слова)\s+(.+?)(?:[?.!]|$)/i,
      /в\s+(?:нашем\s+)?словаре\s+(?:есть|имеется)\s+(?:ли\s+)?(?:слово|выражение|фраза)?\s*(.+?)(?:[?.!]|$)/i,
      /в\s+(?:нашем\s+)?словаре\s+(?:слово|выражение|фраза)?\s*(.+?)\s+(?:есть|имеется)(?:[?.!]|$)/i,
      /(?:есть|имеется)\s+в\s+(?:нашем\s+)?словаре\s+(?:слово|выражение|фраза)?\s*(.+?)(?:[?.!]|$)/i,
      /(?:есть|имеется)\s+ли\s+(?:в\s+(?:нашем\s+)?словаре\s+)?(?:слово|выражение|фраза)?\s*(.+?)(?:\s+в\s+(?:нашем\s+)?словаре)?(?:[?.!]|$)/i,
      /(?:есть|имеется)\s+(?:слово|выражение|фраза)?\s*(.+?)\s+в\s+(?:нашем\s+)?словаре(?:[?.!]|$)/i,
      /(?:слово|выражение|фраза)\s+(.+?)\s+(?:есть|имеется)\s+в\s+(?:нашем\s+)?словаре(?:[?.!]|$)/i,
      /(?:проверь|посмотри|найди|поищи)\s+(?:в\s+(?:нашем\s+)?словаре\s+)?(?:слово|выражение|фраза)?\s*(.+?)(?:\s+в\s+(?:нашем\s+)?словаре)?(?:[?.!]|$)/i,
    ];

    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match) {
        this.addDictionaryLookupCandidate(candidates, match[1]);
      }
    }

    return candidates;
  }

  private addDictionaryLookupCandidate(
    candidates: string[],
    rawValue: string,
  ): void {
    const candidate = this.cleanDictionaryLookupCandidate(rawValue);
    if (
      !candidate ||
      candidates.includes(candidate) ||
      !this.isLikelyDictionaryWord(candidate)
    ) {
      return;
    }

    candidates.push(candidate);
  }

  private cleanDictionaryLookupCandidate(value: string): string {
    return this.cleanDictionaryWord(value)
      .replace(/^(?:слово|слова|фраза|фразу)\s+/i, '')
      .replace(/^(?:на|по)\s+(?:русский|цинцкарский)\s+/i, '')
      .replace(/\s+(?:на|по)\s+(?:русский|цинцкарский)$/i, '')
      .trim();
  }

  private splitDictionaryEntryLines(body: string): string[] {
    const lines: string[] = [];

    for (const rawLine of body.split(/\r?\n/g)) {
      const segments = rawLine.split(';');
      let current = '';

      for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;

        if (current && this.extractDictionaryEntryLine(trimmed)) {
          lines.push(current);
          current = trimmed;
          continue;
        }

        current = current ? `${current}; ${trimmed}` : trimmed;
      }

      if (current) lines.push(current);
    }

    return lines;
  }

  private shouldUseAiDictionaryParser(
    body: string,
    localEntries: DictionaryEntryInput[],
  ): boolean {
    if (!this.hasDictionaryAddIntent(body)) {
      return false;
    }

    const candidateLineCount = this.countLikelyDictionaryCandidateLines(body);
    if (candidateLineCount > 0 && localEntries.length < candidateLineCount) {
      return true;
    }

    return (
      localEntries.length === 0 && this.hasLooseDictionaryEntrySignals(body)
    );
  }

  private countLikelyDictionaryCandidateLines(body: string): number {
    return body
      .split(/\r?\n/g)
      .filter((line) => this.isLikelyDictionaryCandidateLine(line)).length;
  }

  private isLikelyDictionaryCandidateLine(line: string): boolean {
    const trimmed = line.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '');
    if (!trimmed) return false;
    if (this.isDictionaryInstructionLine(trimmed)) return false;
    if (this.isNonDictionaryListLine(trimmed)) return false;
    if (this.extractDictionaryEntryLine(trimmed)) return true;

    const normalized = this.stripDictionaryPairIntent(trimmed);
    if (!this.hasLooseDictionaryEntrySignals(normalized)) return false;

    const tokens = normalized.split(/\s+/g).filter(Boolean);
    return tokens.length >= 2 && tokens.length <= 16;
  }

  private isDictionaryInstructionLine(line: string): boolean {
    if (
      this.hasDictionaryAddIntent(line) &&
      /(?:^|[\s,.:;!?])слова?:?\s*$/i.test(line)
    ) {
      return true;
    }

    return /^(?:проанализируй|проверь|посмотри|разбери|добавь|добавить|запиши|записать|нов(?:ое|ые|ых)\s+)?(?:эти\s+)?слова?:?\s*$/i.test(
      line,
    );
  }

  private isNonDictionaryListLine(line: string): boolean {
    return (
      /^🏆/.test(line) ||
      /топ\s+добавивш/i.test(line) ||
      line.startsWith('@') ||
      /(?:^|\s)@\w+/.test(line) ||
      /^\d+\s+слов[ао]?$/i.test(line)
    );
  }

  private hasLooseDictionaryEntrySignals(text: string): boolean {
    return (
      /[а-яёâãáàäāôóòöōûŷúùüū]/i.test(text) &&
      (/(?:[-—=:]|значит|означает|перевод|это)/i.test(text) ||
        text.split(/\s+/g).filter(Boolean).length >= 2)
    );
  }

  private deduplicateDictionaryEntries(
    entries: DictionaryEntryInput[],
  ): DictionaryEntryInput[] {
    const deduplicated: DictionaryEntryInput[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = `${entry.word}\u0000${entry.translation}\u0000${entry.partOfSpeech ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduplicated.push(entry);
    }
    return deduplicated;
  }

  private normalizeCyrillicLookalikes(value: string): string {
    return value
      .replace(/a/g, 'а')
      .replace(/c/g, 'с')
      .replace(/e/g, 'е')
      .replace(/o/g, 'о')
      .replace(/p/g, 'р')
      .replace(/x/g, 'х')
      .replace(/y/g, 'у');
  }

  private stripDictionaryWordNoise(value: string): string {
    let word = value;
    let previous = '';

    while (word !== previous) {
      previous = word;
      word = word
        .replace(/^[\s"'«»“”„`.,;:!?()[\]{}\-—]+/g, '')
        .replace(/[\s"'«»“”„`.,;:!?()[\]{}\-—]+$/g, '')
        .replace(/^(?:в\s+словар(?:ь|е)|словар(?:ь|е))\s+/i, '')
        .replace(
          /^(?:правописани[ея]|написани[ея]|орфографи[яю])\s+(?:слова?\s+)?/i,
          '',
        )
        .replace(/\s+/g, ' ')
        .trim();
    }

    return word;
  }

  private extractDictionaryEntryLine(
    line: string,
  ): DictionaryEntryInput | null {
    const trimmed = this.stripDictionaryPairIntent(
      line.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''),
    );
    const match =
      trimmed.match(/^(.+?)\s+(?:[-—=])\s+(.+?)\s*;?\s*$/) ??
      trimmed.match(/^(.+?)(?:[-—=])\s+(.+?)\s*;?\s*$/) ??
      trimmed.match(/^(.+?)\s*:\s+(.+?)\s*;?\s*$/);
    if (!match) return null;

    const word = this.cleanDictionaryWord(match[1]);
    const translation = this.cleanDictionaryTranslation(match[2]);
    if (
      !word ||
      !translation ||
      !this.isLikelyDictionaryWord(word) ||
      this.isLikelyLeaderboardLine(word, translation)
    ) {
      return null;
    }

    return { word, translation, partOfSpeech: null };
  }

  private hasDictionaryAddIntent(text: string): boolean {
    return /(?:^|[\s,.:;!?])(?:добавь|добавить|запиши|записать|пиши|исправь|исправить|поправь|поправить|обнови|обновить|измени|изменить|нов(?:ое|ые|ых)\s+слов\w*|слова\s+в\s+словарь|в\s+словарь)(?:$|[\s,.:;!?])/i.test(
      text,
    );
  }

  private stripDictionaryPairIntent(line: string): string {
    return line.replace(
      /^(?:добавь|добавить|запиши|записать|пиши|исправь|исправить|поправь|поправить|обнови|обновить|измени|изменить)\s+(?:(?:это|слово|перевод|запись)\s+)?/i,
      '',
    );
  }

  private isLikelyDictionaryWord(word: string): boolean {
    return (
      word.length <= 80 &&
      /[а-яёâãáàäāôóòöōûŷúùüū]/i.test(word) &&
      !/[@#/:\\\d]/.test(word) &&
      !/(?:^|\s)(?:это|переводится|значит|означает|словарь|словаре|правописание|написание)(?:\s|$)/i.test(
        word,
      )
    );
  }

  private isLikelyLeaderboardLine(word: string, translation: string): boolean {
    return (
      word.startsWith('@') ||
      /(?:^|\s)@\w+/.test(word) ||
      /^\d+\s+слов[ао]?$/i.test(translation)
    );
  }

  private async handleDictionaryAdditions(
    ctx: Context,
    chatId: number,
    username: string,
    messageId: number | undefined,
    entries: DictionaryEntryInput[],
  ): Promise<void> {
    const created: string[] = [];
    const expanded: string[] = [];
    const unchanged: string[] = [];
    const failed: { word: string; err: unknown }[] = [];

    for (const rawEntry of entries) {
      const entry = this.sanitizeDictionaryEntryForSave(rawEntry);
      if (!entry) {
        this.logger.warn(
          `[Chat ${chatId}] Skipped suspicious dictionary entry by @${username}: ${rawEntry.word} = ${rawEntry.translation}`,
        );
        failed.push({ word: rawEntry.word, err: 'suspicious_entry' });
        continue;
      }

      try {
        const upserted = await this.dictionaryService.upsertWord({
          word: entry.word,
          translation: entry.translation,
          partOfSpeech: entry.partOfSpeech,
          addedBy: username,
        });
        const posTag = entry.partOfSpeech ? ` (${entry.partOfSpeech})` : '';
        const displayedTranslation =
          !upserted.created && upserted.translationAdded
            ? upserted.addedTranslation || entry.translation
            : entry.translation;
        const line = `${upserted.word.word} — ${displayedTranslation}${posTag}`;
        if (upserted.created) {
          created.push(line);
        } else if (upserted.translationAdded) {
          expanded.push(line);
        } else {
          unchanged.push(line);
        }
        this.logger.log(
          `[Chat ${chatId}] Dictionary ${upserted.created ? 'created' : upserted.translationAdded ? 'expanded' : 'unchanged'} by @${username}: ${entry.word} = ${entry.translation}${posTag}`,
        );
      } catch (err) {
        this.logger.error(
          `[Chat ${chatId}] upsertWord failed for "${entry.word}":`,
          err,
        );
        failed.push({ word: entry.word, err });
      }
    }

    if (messageId != null) {
      const lines: string[] = [];
      if (created.length > 0) {
        lines.push(
          created.length === 1
            ? `✅ записал:`
            : `✅ записал (${created.length}):`,
        );
        for (const l of created) lines.push(`• ${l}`);
      }
      if (expanded.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(
          expanded.length === 1
            ? `➕ добавил перевод к слову:`
            : `➕ добавил переводы к словам (${expanded.length}):`,
        );
        for (const l of expanded) lines.push(`• ${l}`);
      }
      if (unchanged.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(
          unchanged.length === 1
            ? `ℹ️ такой перевод уже был:`
            : `ℹ️ такие переводы уже были (${unchanged.length}):`,
        );
        for (const l of unchanged) lines.push(`• ${l}`);
      }
      if (failed.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(
          `⚠️ не получилось сохранить: ${failed.map((f) => f.word).join(', ')}`,
        );
      }

      if (lines.length === 0) {
        await ctx.reply('Не получилось ничего сохранить.', {
          reply_parameters: { message_id: messageId },
        });
        return;
      }

      await ctx.reply(lines.join('\n'), {
        reply_parameters: { message_id: messageId },
      });
    }
  }

  private extractDirectDictionaryUpdate(
    text: string,
  ): DictionaryUpdateInput | null {
    const body = text
      .replace(TelegramUpdate.BOT_MENTION_REGEX, '')
      .trim()
      .replace(/\s+/g, ' ');

    const correction = body.match(
      /^(?:измени|исправь|поправь|обнови)\s+(.+?)\s+(?:это|будет|=|—|-)\s+(.+?)\s*,?\s+а\s+не\s+(.+?)[.!?]*$/i,
    );
    if (correction) {
      const translation = this.cleanDictionaryTranslation(correction[1]);
      const newWord = this.cleanDictionaryWord(correction[2]);
      const oldWord = this.cleanDictionaryWord(correction[3]);
      if (oldWord && newWord && translation) {
        return { oldWord, newWord, translation };
      }
    }

    const rename = body.match(
      /^(?:измени|исправь|поправь|обнови)\s+(.+?)\s+(?:на|в)\s+(.+?)(?:[\s,]+(?:перевод|значит)\s+(.+))?[.!?]*$/i,
    );
    if (rename) {
      const oldWord = this.cleanDictionaryWord(rename[1]);
      const newWord = this.cleanDictionaryWord(rename[2]);
      const translation = rename[3]
        ? this.cleanDictionaryTranslation(rename[3])
        : null;
      if (oldWord && newWord) {
        return { oldWord, newWord, translation };
      }
    }

    const translationOnly = body.match(
      /^(?:измени|исправь|поправь|обнови)\s+(?:перевод\s+)?(.+?)\s+(?:перевод|значит)\s+(.+?)[.!?]*$/i,
    );
    if (translationOnly) {
      const oldWord = this.cleanDictionaryWord(translationOnly[1]);
      const translation = this.cleanDictionaryTranslation(translationOnly[2]);
      if (oldWord && translation) {
        return { oldWord, newWord: null, translation };
      }
    }

    return null;
  }

  private cleanDictionaryWord(value: string): string {
    const word = value
      .toLowerCase()
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}\-—]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}\-—]+$/g, '')
      .replace(/\s+/g, ' ');

    return this.normalizeCyrillicLookalikes(
      this.stripDictionaryWordNoise(word),
    );
  }

  private cleanDictionaryTranslation(value: string): string {
    return value
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  private extractTrailingPartOfSpeech(translation: string): {
    translation: string;
    partOfSpeech: string | null;
  } {
    const match = translation.match(
      /\s*\((сущ\.?|гл\.?|прил\.?|нар\.?|мест\.?|межд\.?|предл\.?|союз|числ\.?|част\.?)\)\s*$/i,
    );
    if (!match) {
      return { translation, partOfSpeech: null };
    }

    return {
      translation: translation.slice(0, match.index).trim(),
      partOfSpeech: match[1].trim(),
    };
  }

  private cleanDictionaryTranslationNoise(translation: string): string {
    return this.cleanDictionaryTranslation(
      translation.replace(
        /\s*\((?:есть|нет)\s+в\s+(?:эталонном\s+)?словар[еьи][^)]*\)\s*/gi,
        ' ',
      ),
    );
  }

  private sanitizeDictionaryEntryForSave(
    entry: DictionaryEntryInput,
  ): DictionaryEntryInput | null {
    const word = this.cleanDictionaryWord(entry.word);
    let translation = this.cleanDictionaryTranslation(entry.translation);
    let partOfSpeech = entry.partOfSpeech?.trim() || null;

    const extracted = this.extractTrailingPartOfSpeech(translation);
    translation = this.cleanDictionaryTranslationNoise(extracted.translation);
    if (!partOfSpeech && extracted.partOfSpeech) {
      partOfSpeech = extracted.partOfSpeech;
    }

    if (
      !word ||
      !translation ||
      !this.isLikelyDictionaryWord(word) ||
      this.isLikelyLeaderboardLine(word, translation)
    ) {
      return null;
    }

    return { word, translation, partOfSpeech };
  }

  private async handleDictionaryUpdates(
    ctx: Context,
    chatId: number,
    username: string,
    messageId: number | undefined,
    entries: DictionaryUpdateInput[],
  ): Promise<void> {
    if (entries.length > TelegramUpdate.MAX_UPDATE_BATCH) {
      if (messageId != null) {
        await ctx.reply(
          `За один раз можно поправить до ${TelegramUpdate.MAX_UPDATE_BATCH} слов. Пришли остальные отдельно.`,
          { reply_parameters: { message_id: messageId } },
        );
      }
      return;
    }

    const updated: string[] = [];
    const notFound: string[] = [];
    const ambiguous: string[] = [];
    const failed: string[] = [];

    for (const entry of entries) {
      try {
        const result = await this.dictionaryService.updateWord({
          oldWord: entry.oldWord,
          newWord: entry.newWord,
          translation: entry.translation,
          partOfSpeech: entry.partOfSpeech,
          updatedBy: username,
        });

        if (
          (result.status === 'updated' || result.status === 'merged') &&
          result.word
        ) {
          const posTag = result.word.partOfSpeech
            ? ` (${result.word.partOfSpeech})`
            : '';
          const wordLabel =
            result.resolvedOldWord &&
            result.resolvedOldWord !== result.word.word
              ? `${result.resolvedOldWord} → ${result.word.word}`
              : result.word.word;
          updated.push(`${wordLabel} — ${result.word.translation}${posTag}`);
          this.logger.log(
            `[Chat ${chatId}] Dictionary updated by @${username}: ${wordLabel} = ${result.word.translation}${posTag}`,
          );
          continue;
        }

        if (result.status === 'ambiguous' && result.candidates?.length) {
          ambiguous.push(
            `${entry.oldWord}: ${result.candidates.slice(0, 5).join(', ')}`,
          );
          continue;
        }

        if (result.status === 'not_found') {
          notFound.push(entry.oldWord);
          continue;
        }
      } catch (err) {
        this.logger.error(
          `[Chat ${chatId}] updateWord failed for "${entry.oldWord}":`,
          err,
        );
        failed.push(entry.oldWord);
      }
    }

    if (messageId == null) return;

    const lines: string[] = [];
    if (updated.length > 0) {
      lines.push('✅ поправил:');
      for (const line of updated) lines.push(`• ${line}`);
    }
    if (notFound.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`⚠️ не нашёл в словаре: ${notFound.join(', ')}`);
    }
    if (ambiguous.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('⚠️ нашёл несколько похожих, уточни:');
      for (const line of ambiguous) lines.push(`• ${line}`);
    }
    if (failed.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`⚠️ не получилось поправить: ${failed.join(', ')}`);
    }

    if (lines.length === 0) {
      await ctx.reply('Не понял, что именно нужно поправить.', {
        reply_parameters: { message_id: messageId },
      });
      return;
    }

    await ctx.reply(lines.join('\n'), {
      reply_parameters: { message_id: messageId },
    });
  }

  private extractBotMemoryText(text: string): string | null {
    const match = text.match(
      /^\s*(?:бот|баласи)[\s,:!.\-—]+(?:добавь\s+в\s+память|запомни|сохрани\s+в\s+памят[ьи])[\s,:!.\-—]*([\s\S]*)$/i,
    );
    if (!match) return null;
    return match[1].trim();
  }

  private async saveBotMemory(
    ctx: Context,
    chatId: number,
    threadId: number | null,
    username: string,
    messageId: number | undefined,
    memoryText: string,
  ): Promise<void> {
    if (!(await this.isAdmin(ctx, username))) {
      if (messageId != null) {
        await ctx.reply('Память бота могут менять только администраторы.', {
          reply_parameters: { message_id: messageId },
        });
      }
      return;
    }

    const trimmed = memoryText.trim();
    if (!trimmed) {
      if (messageId != null) {
        await ctx.reply('Что именно добавить в память?', {
          reply_parameters: { message_id: messageId },
        });
      }
      return;
    }

    try {
      await this.telegramService.addBotMemory(
        chatId,
        threadId,
        trimmed,
        username,
      );
      this.logger.log(
        `[Chat ${chatId}] @${username} added bot memory: "${trimmed}"`,
      );
      if (messageId != null) {
        await ctx.reply('🧠 Запомнил.', {
          reply_parameters: { message_id: messageId },
        });
      }
    } catch (err) {
      this.logger.error(`[Chat ${chatId}] addBotMemory failed:`, err);
      if (messageId != null) {
        await ctx.reply('Не получилось сохранить в память, попробуй ещё раз.', {
          reply_parameters: { message_id: messageId },
        });
      }
    }
  }

  private isWorkingLinksRequest(text: string): boolean {
    return TelegramUpdate.WORKING_LINKS_REQUEST_REGEX.test(text);
  }

  private needsRecentMessagesContext(text: string): boolean {
    return TelegramUpdate.RECENT_MESSAGES_CONTEXT_REGEX.test(text);
  }

  private needsBotMemoryContext(text: string): boolean {
    return TelegramUpdate.BOT_MEMORY_CONTEXT_REGEX.test(text);
  }

  private limitRecentMessagesByChars(
    messages: { username: string; text: string; sentAt: Date }[],
    maxChars: number,
  ): { username: string; text: string; sentAt: Date }[] {
    const selected: { username: string; text: string; sentAt: Date }[] = [];
    let totalChars = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const estimatedChars = message.text.length + message.username.length + 24;
      if (selected.length > 0 && totalChars + estimatedChars > maxChars) {
        break;
      }
      selected.unshift(message);
      totalChars += estimatedChars;
    }

    return selected;
  }

  private isLeaderboardRequest(text: string): boolean {
    return TelegramUpdate.LEADERBOARD_REQUEST_REGEX.test(text);
  }

  private async replyWithLeaderboard(
    ctx: Context,
    messageId?: number,
  ): Promise<void> {
    const leaders = await this.dictionaryService.getLeaderboard(10);
    const message = this.formatLeaderboardMessage(leaders);

    if (messageId != null) {
      await ctx.reply(message, {
        reply_parameters: { message_id: messageId },
      });
      return;
    }

    await ctx.reply(message);
  }

  private formatLeaderboardMessage(
    leaders: Array<{ username: string; wordsCount: number }>,
  ): string {
    if (leaders.length === 0) {
      return 'Пока нет добавленных через чат слов.';
    }

    const lines = leaders.map((leader, index) => {
      const wordLabel = this.pluralize(
        leader.wordsCount,
        'слово',
        'слова',
        'слов',
      );
      return `${index + 1}. @${leader.username} — ${leader.wordsCount} ${wordLabel}`;
    });

    return '🏆 Топ добавивших слова:\n' + lines.join('\n');
  }

  private async replyWithWorkingLinks(
    ctx: Context,
    messageId: number | undefined,
    botMemory: BotMemoryEntry[],
  ): Promise<void> {
    const siteUrl = this.findSiteUrlInMemory(botMemory);

    const message = siteUrl
      ? `Рабочая ссылка: ${siteUrl}`
      : 'Ссылка на сайт пока не сохранена. Добавь её в память командой /memoryadd Сайт: и вставь полный URL.';

    if (messageId != null) {
      await ctx.reply(message, {
        reply_parameters: { message_id: messageId },
      });
      return;
    }

    await ctx.reply(message);
  }

  private findSiteUrlInMemory(botMemory: BotMemoryEntry[]): string | null {
    const siteEntries = botMemory.filter((entry) =>
      /(?:сайт|site|url|ссылка)/i.test(entry.text),
    );
    const preferred = this.findFirstUrl(siteEntries);
    if (preferred) return preferred;
    return this.findFirstUrl(botMemory);
  }

  private findFirstUrl(botMemory: BotMemoryEntry[]): string | null {
    for (const entry of botMemory) {
      const match = entry.text.match(TelegramUpdate.URL_REGEX);
      if (match) {
        return match[0].replace(/[),.;!?]+$/, '');
      }
    }
    return null;
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] Received /status command`);
    const count = await this.telegramService.getCount(chatId);
    await ctx.reply(
      `📊 Собрано сообщений: ${count}/${this.threshold}\n` +
        `Используйте /report для создания отчёта.`,
    );
  }

  @Command('report')
  async onReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] Received /report command`);
    await this.generateReport(ctx);
  }

  @Command('clear')
  async onClear(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const chatId = ctx.chat!.id;
    await this.telegramService.clearBuffer(chatId);
    await ctx.reply('🗑 Буфер очищен.');
  }

  @Command('leaderboard')
  async onLeaderboard(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    await this.replyWithLeaderboard(ctx);
  }

  @Command('rules')
  async onRules(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    await ctx.reply(
      '📚 <b>Правила цинцкарского языка</b>\n\n' +
        '<b>Существительные</b>\n' +
        'Нет рода. Есть единственное и множественное число, а также падежи.\n\n' +
        '<b>Множественное число существительных</b>\n\n' +
        '<b>1. После мягких гласных</b>\n' +
        'Последняя гласная основы: <code>â, e, и, û, ô, ŷ</code>\n' +
        'Аффикс: <code>-лâр</code>\n' +
        '<pre>Âв    → Âвлâр\nЕр    → Ерлâр\nÂми   → Âмилâр\nŶрач  → Ŷрачлâр</pre>\n' +
        'дом — дома; земля — земли; дядя — дяди; сердце — сердца.\n\n' +
        '<b>2. После твёрдых гласных</b>\n' +
        'Последняя гласная основы: <code>а, и, о</code>\n' +
        'Аффикс: <code>-лар</code>\n' +
        '<pre>Ана   → Аналар\nЧам   → Чамлар\nУшах  → Ушахлар\nТоп   → Топлар</pre>\n' +
        'мать — матери; дерево — деревья; ребёнок — дети; мяч — мячи.\n\n' +
        '<b>Другие примеры</b>\n' +
        '<pre>Гхари  → гхарылар\nДаи    → даûлар\nДжêчи  → джêчылâр</pre>\n' +
        'женщина — женщины; дядя — дяди; коза — козы.\n\n' +
        '<b>3. Слова на Л, Н, Т</b>\n' +
        'Если слово заканчивается на <code>л</code>, <code>н</code> или <code>т</code>, последняя согласная удваивается. Используются окончания <code>-ар</code> и <code>-âр</code>.\n' +
        '<pre>Нал    → наллар\nАт     → аттар\nТорун  → торуннар\nЧапут  → чапуттар</pre>\n' +
        'подкова — подковы; лошадь — лошади; внук — внуки; тряпка — тряпки.\n\n' +
        '<b>Примечания</b>\n' +
        '• Если слово заканчивается на <code>и</code>, во множественном числе она переходит в <code>û</code> или <code>ы</code>.\n' +
        '• Если перед существительным стоит числительное, аффиксы <code>-лâр</code> и <code>-лар</code> не ставятся.\n\n' +
        '<b>Примеры:</b> ичи âв, он адам, беш алма, он алтû кампет.',
      { parse_mode: 'HTML' },
    );
  }

  @Command('memory')
  async onMemory(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    const chatId = ctx.chat!.id;
    const entries = await this.telegramService.listBotMemory(chatId, 50);
    if (entries.length === 0) {
      await ctx.reply('Память бота пока пустая.');
      return;
    }

    const lines = entries.map((entry) => {
      const scope = entry.chatId === 0 ? 'общая' : 'чат';
      return `#${entry.id} [${scope}] ${entry.text}`;
    });
    const message =
      '🧠 Память бота:\n' +
      lines.join('\n') +
      '\n\n/memoryadd текст\n/memoryedit id новый текст\n/memorydel id';

    for (const chunk of this.chunkString(message, 3900)) {
      await ctx.reply(chunk);
    }
  }

  @Command('memoryadd')
  async onMemoryAdd(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memoryadd']);
    if (!payload) {
      await ctx.reply('Напиши так: /memoryadd что запомнить');
      return;
    }

    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';
    const saved = await this.telegramService.addBotMemory(
      chatId,
      threadId,
      payload,
      username,
    );

    await ctx.reply(`🧠 Добавил в память #${saved.id}.`);
  }

  @Command('memoryedit')
  async onMemoryEdit(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memoryedit']);
    const parsed = payload.match(/^#?(\d+)\s+([\s\S]+)$/);
    if (!parsed || !parsed[2].trim()) {
      await ctx.reply('Напиши так: /memoryedit id новый текст');
      return;
    }

    const chatId = ctx.chat!.id;
    const username = ctx.from?.username || 'unknown';
    const updated = await this.telegramService.updateBotMemory(
      chatId,
      Number(parsed[1]),
      parsed[2],
      username,
    );

    if (!updated) {
      await ctx.reply('Не нашёл такую запись памяти для этого чата.');
      return;
    }

    await ctx.reply(`🧠 Обновил память #${updated.id}.`);
  }

  @Command('memorydel')
  @Hears(/^\/memorydelete(?:@\w+)?(?:\s|$)/i)
  async onMemoryDelete(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memorydel', 'memorydelete']);
    const parsed = payload.match(/^#?(\d+)$/);
    if (!parsed) {
      await ctx.reply('Напиши так: /memorydel id');
      return;
    }

    const chatId = ctx.chat!.id;
    const username = ctx.from?.username || 'unknown';
    const deleted = await this.telegramService.deleteBotMemory(
      chatId,
      Number(parsed[1]),
      username,
    );

    if (!deleted) {
      await ctx.reply('Не нашёл такую запись памяти для этого чата.');
      return;
    }

    await ctx.reply(`🧠 Удалил память #${parsed[1]}.`);
  }

  @Command('setsummarythread')
  @Hears(/^\/setSummaryThread(?:@\w+)?(?:\s|$)/)
  async onSetSummaryThread(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Команду нужно вызывать в группе (и нужном топике).');
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.telegramService.setSummaryTarget(chatId, threadId, username);

    await ctx.reply(
      `✅ Отчёты и подробные описания обсуждений будут приходить сюда.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('clearsummarythread')
  async onClearSummaryThread(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    await this.telegramService.clearSummaryTarget();
    await ctx.reply(
      '🛑 Отдельный топик отчётов отключён. Используйте /setsummarythread чтобы включить снова.',
    );
  }

  @Command('summarythreadstatus')
  async onSummaryThreadStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const target = await this.telegramService.getSummaryTarget();
    if (!target) {
      await ctx.reply(
        '⚠️ Топик отчётов не настроен.\nВызови /setsummarythread в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    await ctx.reply(
      `📍 Отчёты идут сюда:\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${setAt.toISOString()}`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('setpollchat')
  async onSetPollChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Команду нужно вызывать в группе (и нужном топике).');
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.pollConfigService.set(chatId, threadId, username);

    await ctx.reply(
      `✅ Опросы будут приходить сюда.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>\n\n` +
        `Расписание: 8, 10, 12, 14, 16, 18, 20 МСК — два опроса в каждой точке.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('clearpollchat')
  async onClearPollChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    await this.pollConfigService.clear();
    await ctx.reply(
      '🛑 Опросы отключены. Используйте /setpollchat чтобы включить снова.',
    );
  }

  @Command('pollstatus')
  async onPollStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const target = await this.pollConfigService.get();
    if (!target) {
      await ctx.reply(
        '⚠️ Опросы не настроены.\nВызови /setpollchat в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    await ctx.reply(
      `📍 Опросы идут сюда:\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${setAt.toISOString()}\n\n` +
        `Расписание: 8, 10, 12, 14, 16, 18, 20 МСК.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('pollnow')
  async onPollNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const target = await this.pollConfigService.get();
    if (!target) {
      await ctx.reply('⚠️ Сначала настрой через /setpollchat.');
      return;
    }
    await ctx.reply('🚀 Отправляю пару опросов...');
    await this.pollScheduler.sendBoth();
  }

  @Command('settokenreport')
  async onSetTokenReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;

    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = this.isPrivateChat(ctx)
      ? null
      : (message.message_thread_id ?? null);
    const username = ctx.from?.username || null;

    await this.openaiUsageService.setReportTarget(
      chatId,
      threadId,
      username,
      username,
    );

    await ctx.reply(
      `✅ Ежедневный отчёт по OpenAI токенам будет приходить сюда.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет'}</code>\n\n` +
        `Расписание: каждый день в 09:00 (${OPENAI_USAGE_REPORT_TIME_ZONE}), отчёт за предыдущие сутки.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('cleartokenreport')
  async onClearTokenReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;

    await this.openaiUsageService.clearReportTarget();
    await ctx.reply(
      '🛑 Ежедневный отчёт по OpenAI токенам отключён. Используйте /settokenreport чтобы включить снова.',
    );
  }

  @Command('tokenreport')
  async onTokenReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;

    const range = this.openaiUsageService.getCalendarDayRange(
      new Date(),
      OPENAI_USAGE_REPORT_TIME_ZONE,
    );
    const report = await this.openaiUsageService.buildReport(
      range.start,
      range.end,
      OPENAI_USAGE_REPORT_TIME_ZONE,
      `Отчёт по OpenAI токенам за сегодня (${range.label})`,
    );

    for (const chunk of this.chunkString(report, 3900)) {
      await ctx.reply(chunk);
    }
  }

  @Command('setreviewchat')
  async onSetReviewChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Команду нужно вызывать в группе (и нужном топике).');
      return;
    }

    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.wordReviewService.setTarget(chatId, threadId, username);

    await ctx.reply(
      `✅ Проверка словаря будет приходить сюда.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>\n\n` +
        `Расписание: каждый день в 11:00 по Тбилиси.\n` +
        `В пакете: ${DEFAULT_WORD_REVIEW_LIMIT} слов. Новый пакет приходит сразу после завершения текущего.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('clearreviewchat')
  async onClearReviewChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    await this.wordReviewService.clearTarget();
    await ctx.reply(
      '🛑 Проверка словаря отключена. Используйте /setreviewchat чтобы включить снова.',
    );
  }

  @Command('reviewstatus')
  async onReviewStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    const status = await this.wordReviewService.getStatus();
    if (!status.target) {
      await ctx.reply(
        '⚠️ Проверка словаря не настроена.\nВызови /setreviewchat в нужном топике.',
      );
      return;
    }

    const setAt =
      status.target.setAt instanceof Date
        ? status.target.setAt
        : new Date(status.target.setAt);
    const lastSent = status.lastSentAt
      ? (status.lastSentAt instanceof Date
          ? status.lastSentAt
          : new Date(status.lastSentAt)
        ).toISOString()
      : 'ещё не отправляли';

    await ctx.reply(
      `📍 Проверка словаря идёт сюда:\n` +
        `chat_id: <code>${status.target.chatId}</code>\n` +
        `thread_id: <code>${status.target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${status.target.setBy}\n` +
        `когда: ${setAt.toISOString()}\n\n` +
        `Слов из чата всего: ${status.totalChatWords}\n` +
        `Уже отправлялись на проверку: ${status.sentWordCount}\n` +
        `Осталось неотправленных: ${status.remainingWordCount}\n` +
        `Последняя отправка: ${lastSent}`,
      { parse_mode: 'HTML' },
    );

    if (status.activeBatch) {
      await ctx.reply(
        `Активный пакет №${status.activeBatch.id}: ` +
          `${status.activeBatch.confirmed}/${status.activeBatch.total} подтверждено, ` +
          `${status.activeBatch.awaitingCorrection} ожидают исправления.`,
      );
    }
  }

  @Command('reviewnow')
  async onReviewNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }

    try {
      const result = await this.wordReviewService.sendReviewBatch();
      if (result.status === 'no_target') {
        await ctx.reply('⚠️ Сначала настрой через /setreviewchat.');
        return;
      }
      if (result.status === 'no_words') {
        await ctx.reply('Все chat-слова уже отправлялись на проверку.');
        return;
      }
      if (result.status === 'active_batch') {
        await ctx.reply(
          'Сначала нужно завершить текущий пакет. Исправляемые слова задерживают весь пакет.',
        );
        return;
      }

      await ctx.reply(`✅ Отправил ${result.count} слов на проверку.`);
    } catch (err) {
      this.logger.error('Manual word review failed', err);
      await ctx.reply('Ошибка при отправке слов на проверку.');
    }
  }

  @Command('startfactday')
  async onStartFactDay(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Команду нужно вызывать в группе (и нужном топике).');
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.factDayConfigService.set(chatId, threadId, username);

    await ctx.reply(
      `✅ Исторический квиз Цинцкаро запущен в этом топике.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>\n\n` +
        `Расписание: ${FACT_DAY_SCHEDULE_LABEL}.\n` +
        `Всего вопросов: ${this.factDayScheduler.getFactsCount()}.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('stopfactday')
  async onStopFactDay(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const disabled = await this.factDayConfigService.disable();
    if (!disabled) {
      await ctx.reply(
        '⚠️ Исторический квиз ещё не настроен. Включи через /startfactday в нужном топике.',
      );
      return;
    }
    await ctx.reply(
      '🛑 Исторический квиз отключён. Настройка сохранена, включить снова можно через /startfactday.',
    );
  }

  @Command('factdaystatus')
  async onFactDayStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const target = await this.factDayConfigService.get();
    if (!target) {
      await ctx.reply(
        '⚠️ Исторический квиз не настроен.\nВызови /startfactday в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    const quizCount = this.factDayScheduler.getFactsCount();
    const nextQuizNumber =
      (((target.nextFactIndex % quizCount) + quizCount) % quizCount) + 1;
    await ctx.reply(
      `📍 Исторический квиз:\n` +
        `статус: ${target.enabled === false ? 'отключён' : 'включён'}\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${setAt.toISOString()}\n\n` +
        `следующий вопрос: ${nextQuizNumber}/${quizCount}\n` +
        `последняя отправка: ${target.lastSentDate ?? 'ещё не было'}\n` +
        `расписание: ${FACT_DAY_SCHEDULE_LABEL}.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('factdaynow')
  async onFactDayNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Этот бот работает только в групповых чатах.');
      return;
    }
    const result = await this.factDayScheduler.sendNext(true);
    if (result.sent) {
      return;
    }
    if (result.reason === 'not_configured') {
      await ctx.reply('⚠️ Сначала настрой через /startfactday.');
      return;
    }
    if (result.reason === 'disabled') {
      await ctx.reply(
        '⚠️ Исторический квиз отключён. Включи через /startfactday.',
      );
      return;
    }
    await ctx.reply(
      '❌ Не получилось отправить исторический квиз. Проверь логи бота.',
    );
  }

  @Command('threadid')
  async onThreadId(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await ctx.reply('Команду нужно вызывать в группе (и нужном топике).');
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    await ctx.reply(
      `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>`,
      { parse_mode: 'HTML' },
    );
  }

  private async generateReport(ctx: Context) {
    const chatId = ctx.chat!.id;
    const sourceMessage = ctx.message as { message_thread_id?: number };
    const sourceThreadId = sourceMessage?.message_thread_id ?? null;
    const storedMessages = await this.telegramService.getActiveMessages(chatId);
    const messagesText = storedMessages.map((m) => m.text);
    const summaryLinks = new Map<
      string,
      { url: string; username: string; number: number }
    >();
    const messages = storedMessages.map((m, index) => {
      const ref = `m${index + 1}`;
      const link = this.buildTelegramMessageLink(m.chatId, m.telegramMessageId);
      if (link) {
        summaryLinks.set(ref, {
          url: link,
          username: m.username,
          number: index + 1,
        });
      }
      return {
        text: m.text,
        username: m.username,
        ref: link ? ref : undefined,
      };
    });

    if (messagesText.length === 0) {
      await ctx.reply('Сообщений пока нет.');
      return;
    }

    const summaryTarget = await this.telegramService.getSummaryTarget();
    const target = summaryTarget ?? {
      chatId,
      threadId: sourceThreadId,
    };

    try {
      const analysis = await this.openaiService.analyzeDiscussion(messages);
      const words = analysis.words;
      const discussionResult = analysis.discussionResult;

      let report = await this.formatReport(words);
      const summary = this.shortenDiscussionSummary(
        discussionResult.discussionSummary || '',
      );
      if (summary) {
        report +=
          '\n\n---\n\n📝 <b>КОРОТКОЕ САММАРИ:</b>\n' +
          this.formatDiscussionSummary(summary, summaryLinks);
      }

      const savedReport = await this.telegramService.createSummaryReport({
        sourceChatId: chatId,
        sourceThreadId,
        targetChatId: target.chatId,
        targetThreadId: target.threadId,
        messageCount: messagesText.length,
        extractedWords: words,
        discussionResult: discussionResult as unknown as Record<
          string,
          unknown
        >,
        reportText: report,
        discussionSummary: summary || null,
        createdBy: ctx.from?.username || null,
      });

      await this.sendReportToTarget(target.chatId, target.threadId, report);

      await this.telegramService.markMessagesReported(
        storedMessages.map((m) => m.id),
        savedReport.id,
      );
      this.reportOpenAiUnavailableNotifiedChats.delete(chatId);
    } catch (error) {
      this.logger.error('Report error:', error);
      if (!this.reportOpenAiUnavailableNotifiedChats.has(chatId)) {
        this.reportOpenAiUnavailableNotifiedChats.add(chatId);
        await ctx.reply('OpenAI API недоступен.');
      }
    }
  }

  private async sendReportToTarget(
    chatId: number,
    threadId: number | null,
    report: string,
  ): Promise<void> {
    if (report.length > 4000) {
      const chunks = this.chunkString(report, 4000);
      for (const chunk of chunks) {
        await this.bot.telegram.sendMessage(chatId, chunk, {
          parse_mode: 'HTML',
          message_thread_id: threadId ?? undefined,
        });
      }
      return;
    }

    await this.bot.telegram.sendMessage(chatId, report, {
      parse_mode: 'HTML',
      message_thread_id: threadId ?? undefined,
    });
  }

  private shortenDiscussionSummary(summary: string): string {
    const compact = summary
      .trim()
      .replace(/@(?=[A-Za-z0-9_]{3,32}\b)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ');

    if (compact.length <= 700) return compact;

    const boundary = compact.lastIndexOf('.', 680);
    const cutAt = boundary >= 300 ? boundary + 1 : 699;
    return compact.slice(0, cutAt).trimEnd() + '…';
  }

  private formatDiscussionSummary(
    summary: string,
    links: Map<string, { url: string; username: string; number: number }>,
  ): string {
    const escaped = summary
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return escaped.replace(/\[(m\d+)\]/g, (match, ref: string) => {
      const link = links.get(ref);
      if (!link) return match;
      const label = `${this.escapeHtml(link.username)}, сообщение ${link.number}`;
      return `<a href="${link.url}">${label}</a>`;
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private buildTelegramMessageLink(
    chatId: number,
    messageId: number | null,
  ): string | null {
    if (messageId == null) return null;

    const chatIdText = String(chatId);
    if (!chatIdText.startsWith('-100')) return null;

    const internalChatId = chatIdText.slice(4);
    if (!internalChatId) return null;

    return `https://t.me/c/${internalChatId}/${messageId}`;
  }

  private async deleteMessageIfPossible(
    ctx: Context,
    messageId: number,
  ): Promise<void> {
    try {
      await ctx.deleteMessage(messageId);
    } catch {
      this.logger.warn(`Could not delete status message ${messageId}`);
    }
  }

  private pluralize(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  private async formatReport(
    words: Array<{
      word: string;
      possibleTranslation: string | null;
      context: string;
    }>,
  ): Promise<string> {
    // Deduplicate words by their lowercase form, keeping first occurrence
    const seen = new Set<string>();
    const uniqueWords = words.filter((w) => {
      const key = w.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const fromDictionary: Array<{ word: string; translation: string }> = [];
    const translated: Array<{ word: string; translation: string }> = [];
    const untranslated: Array<{ word: string }> = [];

    for (const w of uniqueWords) {
      const dictionaryEntry = await this.dictionaryService.findWord(w.word);
      if (dictionaryEntry) {
        fromDictionary.push({
          word: w.word,
          translation: dictionaryEntry.translation,
        });
        continue;
      }

      const normalizedTranslation =
        w.possibleTranslation && w.possibleTranslation !== 'null'
          ? w.possibleTranslation
          : null;

      if (normalizedTranslation) {
        translated.push({ word: w.word, translation: normalizedTranslation });
      } else {
        untranslated.push({ word: w.word });
      }
    }

    const sectionLines = (items: string[], emptyLabel = '— нет'): string =>
      items.length > 0 ? items.join('\n') : emptyLabel;

    const dictionaryLines = fromDictionary.map(
      (item, index) =>
        `${index + 1}. <b>${item.word}</b> — ${item.translation}`,
    );
    const translatedLines = translated.map(
      (item, index) =>
        `${index + 1}. <b>${item.word}</b> — ${item.translation}`,
    );
    const untranslatedLines = untranslated.map(
      (item, index) => `${index + 1}. <b>${item.word}</b>`,
    );

    let report = '📖 <b>СЛОВАРЬ ЦИНЦКАРО</b>\n\n';
    report +=
      'Слова найденные в словаре:\n' +
      `${sectionLines(dictionaryLines)}\n\n` +
      'Переведенные слова:\n' +
      `${sectionLines(translatedLines)}\n\n` +
      'Непереведенные слова:\n' +
      `${sectionLines(untranslatedLines)}`;

    report += `\n\n📝 Найдено слов: ${uniqueWords.length}`;
    return report;
  }

  private getCommandPayload(ctx: Context, commandNames: string[]): string {
    const text = (ctx.message as { text?: string })?.text ?? '';
    const commandPattern = commandNames
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    return text
      .replace(
        new RegExp(`^/(?:${commandPattern})(?:@\\w+)?(?:\\s+|$)`, 'i'),
        '',
      )
      .trim();
  }

  private chunkString(str: string, size: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = str.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > size) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        currentChunk = line;
      } else {
        currentChunk += (currentChunk ? '\n' : '') + line;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    return chunks;
  }
}
