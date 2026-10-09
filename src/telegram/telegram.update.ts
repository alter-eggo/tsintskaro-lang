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
import { ConversationMessage, TelegramService } from './telegram.service';
import {
  DictionaryEntry,
  DictionaryService,
} from '../dictionary/dictionary.service';
import { TranslationEditForbiddenError } from '../dictionary/translation-permissions';
import {
  BotDictionaryContextEntry,
  OpenaiService,
} from '../openai/openai.service';
import {
  OpenaiUsageService,
  OPENAI_USAGE_REPORT_TIME_ZONE,
} from '../openai/openai-usage.service';
import { PollConfigService } from '../poll/poll-config.service';
import { PollSchedulerService } from '../poll/poll-scheduler.service';
import {
  MAX_WORD_REVIEW_LIMIT,
  ReviewDecisionResult,
  WordReviewService,
} from '../word-review/word-review.service';
import {
  parseReviewDecision,
  ReviewDecisionRequest,
  WordReviewDecisionError,
} from '../word-review/word-review-decision';
import {
  formatReviewDate,
  WORD_REVIEW_SCHEDULE_LABEL,
} from '../word-review/word-review-schedule';
import { FactDayConfigService } from '../fact-day/fact-day-config.service';
import {
  FACT_DAY_SCHEDULE_LABEL,
  FactDaySchedulerService,
} from '../fact-day/fact-day-scheduler.service';
import { ConfigService } from '@nestjs/config';
import { Logger, OnModuleInit } from '@nestjs/common';
import { formatBotDate, formatBotDateTime } from '../common/bot-time';
import {
  DictionaryContentError,
  renderSenses,
  WORD_KIND_LABELS,
} from '../dictionary/dictionary-content';
import { hasWordDeletionGrant } from '../dictionary/deletion-permissions';

type ReportGenerationStage =
  | 'load_messages'
  | 'load_target'
  | 'openai_analysis'
  | 'format_report'
  | 'save_report'
  | 'send_report'
  | 'mark_messages';

interface ErrorDetails {
  name: string | null;
  message: string | null;
  status: number | null;
  code: string | null;
  type: string | null;
  requestId: string | null;
  telegramCode: number | null;
  telegramDescription: string | null;
}

interface ReportFailure {
  fingerprint: string;
  message: string;
}

@Update()
export class TelegramUpdate implements OnModuleInit {
  private readonly threshold: number;
  private readonly logger = new Logger(TelegramUpdate.name);
  private readonly reportFailureNotifications = new Map<number, string>();

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
        command: 'startreview',
        description: 'Запустить разбор слов в этой теме',
      },
      { command: 'stopreview', description: 'Приостановить отправку слов' },
      {
        command: 'reviewsize',
        description: 'Количество слов в партии: /reviewsize 10',
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
        description: 'Отправить дополнительную партию слов',
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
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    this.logger.log('Received /start command');
    await this.replyAndRemember(
      ctx,
      'გამარჯობა! Я бот-словарь Цинцкаро.\n\n' +
        'Я собираю сообщения и нахожу нерусские слова для словаря.\n\n' +
        'Команды:\n' +
        '/report - Создать отчёт сейчас\n' +
        '/status - Показать количество собранных сообщений\n' +
        '/clear - Очистить буфер без отчёта\n' +
        '/setsummarythread - Слать отчёты в этот топик\n' +
        '/settokenreport - Слать ежедневный отчёт по OpenAI токенам сюда\n' +
        '/tokenreport - Показать расход OpenAI токенов за сегодня\n' +
        '/startreview - Запустить разбор слов в этой теме\n' +
        '/stopreview - Приостановить отправку слов\n' +
        '/reviewsize 10 - Задать количество слов в партии\n' +
        '/reviewstatus - Прогресс и следующая отправка\n' +
        '/reviewnow - Дополнительная партия вне очереди\n' +
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
      await this.replyAndRemember(
        ctx,
        'Команды боту доступны только администраторам',
      );
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
      reply_to_message?: { message_id?: number; from?: { id?: number } };
    };
    const text = message.text;
    const threadId = message.message_thread_id;
    const username = message.from?.username || 'anonymous';

    const isReplyToBot =
      ctx.botInfo?.id != null &&
      message.reply_to_message?.from?.id === ctx.botInfo.id;
    const isUsernameMention =
      ctx.botInfo?.username &&
      text.toLowerCase().includes(`@${ctx.botInfo.username.toLowerCase()}`);
    if (
      TelegramUpdate.BOT_MENTION_REGEX.test(text) ||
      isReplyToBot ||
      isUsernameMention
    ) {
      await this.rememberContextMessage({
        chatId,
        threadId: threadId ?? null,
        telegramMessageId: message.message_id ?? null,
        text,
        username,
        isBot: false,
        sentAt: message.date ? new Date(message.date * 1000) : new Date(),
      });
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
    await ctx.answerCbQuery(
      'Голосование кнопками отключено. Обсуждайте слова в теме.',
    );
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (error) {
      this.logger.warn(
        `Could not remove legacy review buttons: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private static readonly BOT_MENTION_REGEX = /^\s*(?:бот|баласи)[\s,:!.\-—]/i;
  private static readonly MAX_DELETE_BATCH = 10;

  private static readonly BOT_CONTEXT_MESSAGE_LIMIT = 50;

  private static readonly BOT_CONTEXT_MAX_CHARS = 40000;

  private static readonly BOT_MEMORY_LIMIT = 50;

  private static readonly BOT_DICTIONARY_CONTEXT_LIMIT = 30;

  private async handleBotMention(
    ctx: Context,
    text: string,
    username: string,
    messageId: number | undefined,
    threadId: number | null,
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] @${username} addressed bot: "${text}"`);
    const reviewDecision = parseReviewDecision(text);
    if (reviewDecision != null && reviewDecision !== 'invalid') {
      await this.handleReviewDecision(ctx, reviewDecision, messageId, threadId);
      return;
    }
    const replyToMessage = this.getReplyContext(ctx);

    const message = ctx.message as {
      forward_origin?: unknown;
      forward_from?: unknown;
      forward_from_chat?: unknown;
      sender_chat?: unknown;
    };
    const readOnly = Boolean(
      message?.forward_origin ||
      message?.forward_from ||
      message?.forward_from_chat ||
      message?.sender_chat ||
      ctx.from?.is_bot ||
      !ctx.from?.id,
    );

    const [loadedRecentMessages, botMemory] = await Promise.all([
      this.telegramService.getRecentMessages(
        chatId,
        threadId,
        TelegramUpdate.BOT_CONTEXT_MESSAGE_LIMIT,
      ),
      this.telegramService.getBotMemory(
        chatId,
        TelegramUpdate.BOT_MEMORY_LIMIT,
      ),
    ]);
    const recentMessages = this.limitRecentMessagesByChars(
      loadedRecentMessages.filter(
        (message) =>
          messageId == null || message.telegramMessageId !== messageId,
      ),
      TelegramUpdate.BOT_CONTEXT_MAX_CHARS,
    );
    const dictionaryEntries = await this.getDictionaryContextEntries(
      text,
      [
        replyToMessage?.text,
        ...recentMessages.map((message) => message.text),
      ].filter(Boolean),
    );
    this.logger.log(
      `[Chat ${chatId}] Loaded ${recentMessages.length} recent messages, ${botMemory.length} memory entries and ${dictionaryEntries.length} dictionary entries for AI context`,
    );

    const showTyping = () =>
      ctx.sendChatAction('typing').catch(() => undefined);
    await showTyping();
    const typingTimer = setInterval(() => {
      void showTyping();
    }, 4000);
    let result;
    try {
      result =
        replyToMessage || readOnly
          ? await this.openaiService.processBotMention(
              text,
              recentMessages,
              botMemory,
              dictionaryEntries,
              {
                ...(replyToMessage ? { replyToMessage } : {}),
                ...(readOnly ? { readOnly: true } : {}),
              },
            )
          : await this.openaiService.processBotMention(
              text,
              recentMessages,
              botMemory,
              dictionaryEntries,
            );
    } catch (err) {
      this.logDetailedError(
        `[Chat ${chatId}] AI processBotMention failed`,
        err,
      );
      if (messageId != null) {
        await this.replyAndRemember(
          ctx,
          `❌ Не удалось получить ответ от OpenAI.\n` +
            `Причина: ${this.describeOpenAiFailureForUser(err)}.\n` +
            `Повтори запрос после устранения причины.`,
          {
            reply_parameters: { message_id: messageId },
          },
        );
      }
      return;
    } finally {
      clearInterval(typingTimer);
    }

    if (result.action === 'reply') {
      this.logger.log(`[Chat ${chatId}] AI reply: ${result.message}`);
      if (messageId != null) {
        for (const chunk of this.chunkBotAnswer(result.message)) {
          await this.replyAndRemember(ctx, chunk, {
            reply_parameters: { message_id: messageId },
          });
        }
      }
      return;
    }

    if (readOnly) {
      await this.replyAndRemember(
        ctx,
        'Это сообщение не изменяет словарь. Напиши просьбу от своего имени; пересланный текст можно приложить как контекст.',
      );
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

    let saved = false;
    try {
      const batch = await this.dictionaryService.applyActions(
        result.operations,
        {
          userId: ctx.from!.id,
          username: this.dictionarySenderUsername(ctx),
          chatId,
          threadId,
          messageId: messageId ?? null,
          canRemoveEntry: await this.canDeleteDictionaryWords(ctx),
        },
        result.snapshots,
      );
      saved = true;
      const lines = [
        batch.unchanged
          ? 'Эта команда уже выполнена.'
          : '✅ Изменения сохранены.',
      ];
      for (const action of result.operations) {
        if (action.type === 'move_example')
          lines.push(
            `«${action.word}» перенесено в «${action.target}» как пример к значению ${action.sense}. История сохранена.`,
          );
      }
      for (const word of batch.words) {
        if (word.status === 'embedded' || word.status === 'merged') continue;
        if (word.status === 'deleted') {
          lines.push(`«${word.word}» убрано из словаря. История сохранена.`);
          continue;
        }
        lines.push('', word.word);
        if (word.status === 'deferred')
          lines.push(
            `Отложено${word.statusReason ? `: ${word.statusReason}` : ''}.`,
          );
        if (word.kind && word.kind !== 'word')
          lines.push(`Тип: ${WORD_KIND_LABELS[word.kind]}`);
        if (word.partOfSpeech) lines.push(`Часть речи: ${word.partOfSpeech}`);
        if (word.literalTranslation)
          lines.push(`Буквально: ${word.literalTranslation}`);
        lines.push(
          word.senses?.length
            ? renderSenses(word.senses, '\n')
            : word.translation,
        );
      }
      const phrases = [
        ...new Set(
          batch.words.flatMap((word) =>
            (word.senses ?? []).flatMap((sense) =>
              sense.examples.map((example) => example.phrase),
            ),
          ),
        ),
      ].sort((a, b) => b.length - a.length);
      for (const chunk of this.chunkBotAnswer(lines.join('\n'))) {
        const entities: { type: 'bold'; offset: number; length: number }[] = [];
        for (const phrase of phrases) {
          for (
            let offset = chunk.indexOf(phrase);
            offset >= 0;
            offset = chunk.indexOf(phrase, offset + phrase.length)
          ) {
            if (
              !entities.some(
                (entity) =>
                  offset < entity.offset + entity.length &&
                  offset + phrase.length > entity.offset,
              )
            )
              entities.push({ type: 'bold', offset, length: phrase.length });
          }
        }
        await this.replyAndRemember(ctx, chunk, {
          ...(entities.length
            ? { entities: entities.sort((a, b) => a.offset - b.offset) }
            : {}),
          ...(messageId == null
            ? {}
            : { reply_parameters: { message_id: messageId } }),
        });
      }
    } catch (error) {
      const message = saved
        ? 'Изменения сохранены, но не удалось отправить результат. Повтори команду: дубликат не появится.'
        : error instanceof DictionaryContentError ||
            error instanceof TranslationEditForbiddenError
          ? `Ничего не изменено. ${error.message}`
          : 'Не удалось сохранить изменения. Все изменения из этой команды отменены; повтори просьбу.';
      if (
        !(error instanceof DictionaryContentError) &&
        !(error instanceof TranslationEditForbiddenError)
      )
        this.logger.error('Dictionary action batch failed', error);
      await this.replyAndRemember(ctx, message);
    }
  }

  private async handleReviewDecision(
    ctx: Context,
    request: ReviewDecisionRequest,
    messageId: number | undefined,
    threadId: number | null,
  ): Promise<void> {
    const message = ctx.message as {
      sender_chat?: unknown;
      forward_origin?: unknown;
      reply_to_message?: { message_id?: number; from?: { id?: number } };
    };
    if (
      !ctx.from?.id ||
      ctx.from.is_bot ||
      message.sender_chat ||
      message.forward_origin
    ) {
      await this.replyAndRemember(
        ctx,
        'Подведите итоги своим сообщением от личного аккаунта, чтобы сохранить автора решения.',
      );
      return;
    }
    const coordinatorIds = this.config.get<number[]>(
      'wordReviewCoordinatorIds',
    );
    const coordinator =
      Array.isArray(coordinatorIds) && coordinatorIds.includes(ctx.from.id);
    if (!coordinator && !(await this.isAdmin(ctx, ctx.from.username))) {
      await this.replyAndRemember(
        ctx,
        'Подводить итоги могут назначенные координаторы и администраторы чата.',
      );
      return;
    }
    let result: ReviewDecisionResult;
    try {
      result = await this.wordReviewService.recordDecision({
        request,
        chatId: ctx.chat!.id,
        threadId,
        replyToMessageId:
          message.reply_to_message?.from?.id === ctx.botInfo?.id
            ? message.reply_to_message?.message_id
            : undefined,
        userId: ctx.from.id,
        username: ctx.from.username ?? null,
        messageId: messageId!,
      });
    } catch (error) {
      if (!(error instanceof WordReviewDecisionError))
        this.logger.error('Could not record word review decision', error);
      await this.replyAndRemember(
        ctx,
        error instanceof WordReviewDecisionError
          ? error.message
          : 'Не удалось завершить сохранение итогов. Повторите сообщение: уже сохранённые решения не потеряются.',
      );
      return;
    }

    const total =
      result.confirmed.length + result.disputed.length + result.pending.length;
    const lines = [
      result.completed
        ? `✅ Партия №${result.batchId} разобрана полностью (${total} из ${total}).`
        : result.confirmed.length
          ? `📝 Партия №${result.batchId} разобрана частично (${result.confirmed.length} из ${total}).`
          : `📝 Партия №${result.batchId} ещё не разобрана (0 из ${total}).`,
    ];
    if (result.alreadyApplied)
      lines.push('Это сообщение уже учтено. Ниже текущий итог.');
    for (const [title, words] of [
      ['Разобраны', result.confirmed],
      ['Спорные — разбор продолжается', result.disputed],
      ['Ожидают итога', result.pending],
    ] as const) {
      lines.push('', `${title}:`);
      lines.push(
        ...(words.length
          ? words.map((word) => `${word.position}. ${word.word}`)
          : ['нет']),
      );
    }
    for (const chunk of this.chunkBotAnswer(lines.join('\n'))) {
      await this.replyAndRemember(ctx, chunk, {
        reply_parameters: { message_id: messageId! },
      });
    }
  }

  private async canDeleteDictionaryWords(ctx: Context): Promise<boolean> {
    const sender = ctx.from;
    const message = ctx.message as { sender_chat?: unknown } | undefined;
    if (
      !sender ||
      !Number.isSafeInteger(sender.id) ||
      sender.id <= 0 ||
      sender.is_bot ||
      message?.sender_chat
    ) {
      return false;
    }
    return (
      hasWordDeletionGrant(this.dictionarySenderUsername(ctx)) ||
      this.isAdmin(ctx, sender.username)
    );
  }

  private async getDictionaryContextEntries(
    text: string,
    contextTexts: string[] = [],
  ): Promise<BotDictionaryContextEntry[]> {
    const candidates = this.extractDictionaryLookupCandidates(text);
    const hasExplicitDirection =
      this.isRussianToTsintskaroLookupRequest(text) ||
      this.isTsintskaroToRussianLookupRequest(text);
    const entries =
      candidates.length > 0
        ? await this.findDictionaryLookupEntries(
            candidates,
            this.isRussianToTsintskaroLookupRequest(text),
            !hasExplicitDirection,
          )
        : [];

    const mentionedEntries = await this.dictionaryService.findRelevantForPrompt(
      [text, ...contextTexts],
      TelegramUpdate.BOT_DICTIONARY_CONTEXT_LIMIT,
    );
    const seen = new Set(entries.map((entry) => entry.word.toLowerCase()));
    for (const entry of mentionedEntries) {
      if (entries.length >= TelegramUpdate.BOT_DICTIONARY_CONTEXT_LIMIT) break;
      if (seen.has(entry.word.toLowerCase())) continue;
      seen.add(entry.word.toLowerCase());
      entries.push(entry);
    }

    return entries.map((entry) => ({
      word: entry.word,
      translation: entry.translation,
      partOfSpeech: entry.partOfSpeech,
      ...(entry.comments ? { comments: entry.comments } : {}),
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.kind ? { kind: entry.kind } : {}),
      ...(entry.literalTranslation
        ? { literalTranslation: entry.literalTranslation }
        : {}),
      ...(entry.senses ? { senses: entry.senses } : {}),
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

  private isRussianToTsintskaroLookupRequest(text: string): boolean {
    return /(?:на\s+цинцкарск(?:ий|ом|ого)?|по[-\s]+цинцкарски)/i.test(text);
  }

  private isTsintskaroToRussianLookupRequest(text: string): boolean {
    return /(?:на\s+русск(?:ий|ом|ого)?|по[-\s]+русски)/i.test(text);
  }

  private extractDictionaryLookupCandidates(text: string): string[] {
    const body = text
      .replace(TelegramUpdate.BOT_MENTION_REGEX, '')
      .trim()
      .replace(/\s+/g, ' ');
    const candidates: string[] = [];

    const quoted = /[«"“„](.+?)[»"”]/g;
    for (const match of body.matchAll(quoted)) {
      this.addDictionaryLookupCandidate(candidates, match[1], true);
    }

    const patterns = [
      /как\s+(?:(?:на\s+(?:русском|цинцкарском)|по[-\s]+(?:русски|цинцкарски))\s+)?(?:будет|сказать)\s+(?:(?:на\s+(?:русском|цинцкарском)|по[-\s]+(?:русски|цинцкарски))\s+)?(.+?)(?:\s+(?:на\s+(?:русском|цинцкарском)|по[-\s]+(?:русски|цинцкарски)))?(?:[?.!]|$)/i,
      /(?:как\s+перевести(?:\s+на\s+(?:русский|цинцкарский))?|переведи(?:\s+на\s+(?:русский|цинцкарский))?)\s+(.+?)(?:[?.!]|$)/i,
      /(?:что\s+(?:значит|означает)|значение\s+слова|перевод\s+слова)\s+(.+?)(?:[?.!]|$)/i,
      /(?:есть|имеется)\s+(?:ли\s+)?(?:такое\s+)?(?:слово|выражение|фраза)\s*[-—:=,]?\s*(.+?)(?:[?.!]|$)/i,
      /(?:есть|имеется)\s+в\s+(?:нашем\s+)?словаре\s*[:,—-]?\s*(?:слово|слова|выражение|фраза)?\s*(.+?)(?:[?.!]|$)/i,
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
    explicitlyQuoted = false,
  ): void {
    const candidate = this.cleanDictionaryLookupCandidate(rawValue);
    if (
      !explicitlyQuoted &&
      /^(?:его|е[её]|их|он[аои]?|этот|эту|эти|такое)(?:\s+(?:слово|слова|фразу|выражение))?$/i.test(
        candidate,
      )
    ) {
      return;
    }
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
      .replace(
        /^(?:на\s+(?:русский|цинцкарский)|по[-\s]+(?:русски|цинцкарски))\s+/i,
        '',
      )
      .replace(
        /\s+(?:на\s+(?:русский|цинцкарский)|по[-\s]+(?:русски|цинцкарски))$/i,
        '',
      )
      .trim();
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

  private isLikelyDictionaryWord(word: string): boolean {
    return (
      word.length <= 80 &&
      /[а-яёêâãáàäāôóòöōûŷúùüū]/i.test(word) &&
      !/[@#/:\\\d]/.test(word) &&
      !/(?:^|\s)(?:это|переводится|значит|означает|словарь|словаре|правописание|написание)(?:\s|$)/i.test(
        word,
      )
    );
  }

  private cleanDictionaryWord(value: string): string {
    const word = value
      .normalize('NFC')
      .toLowerCase()
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}\-—]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}\-—]+$/g, '')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s+/g, ' ');

    return this.normalizeCyrillicLookalikes(
      this.stripDictionaryWordNoise(word),
    );
  }

  private dictionarySenderUsername(ctx: Context): string | null {
    const sender = ctx.from;
    const message = ctx.message as { sender_chat?: unknown } | undefined;
    return sender &&
      Number.isSafeInteger(sender.id) &&
      sender.id > 0 &&
      !sender.is_bot &&
      !message?.sender_chat
      ? (sender.username ?? null)
      : null;
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
        await this.replyAndRemember(
          ctx,
          'Память бота могут менять только администраторы.',
          {
            reply_parameters: { message_id: messageId },
          },
        );
      }
      return;
    }

    const trimmed = memoryText.trim();
    if (!trimmed) {
      if (messageId != null) {
        await this.replyAndRemember(ctx, 'Что именно добавить в память?', {
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
    } catch (err) {
      this.logger.error(`[Chat ${chatId}] addBotMemory failed:`, err);
      if (messageId != null) {
        await this.replyAndRemember(
          ctx,
          'Не получилось сохранить в память, попробуй ещё раз.',
          {
            reply_parameters: { message_id: messageId },
          },
        );
      }
    }
  }

  private getReplyContext(ctx: Context): ConversationMessage | undefined {
    const message = ctx.message;
    if (!message || !('reply_to_message' in message)) return undefined;
    const reply = message.reply_to_message;
    if (!reply) return undefined;
    const text =
      'text' in reply
        ? reply.text
        : 'caption' in reply
          ? reply.caption
          : undefined;
    if (!text) return undefined;
    return {
      text,
      username: reply.from?.username || reply.from?.first_name || 'anonymous',
      sentAt: new Date(reply.date * 1000),
      telegramMessageId: reply.message_id,
      isBot: reply.from?.id === ctx.botInfo?.id,
    };
  }

  private async rememberContextMessage(
    message: ConversationMessage & { chatId: number; threadId: number | null },
  ): Promise<void> {
    try {
      await this.telegramService.saveContextMessage(message);
    } catch (error) {
      this.logger.error(
        `Could not save conversation context in chat ${message.chatId}`,
        error,
      );
    }
  }

  private chunkBotAnswer(text: string): string[] {
    const chunks: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      let end = Math.min(offset + 4000, text.length);
      if (end < text.length) {
        const newline = text.lastIndexOf('\n', end - 1);
        const space = text.lastIndexOf(' ', end - 1);
        const boundary = newline > offset + 2000 ? newline : space;
        if (boundary > offset + 2000) end = boundary + 1;
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
      }
      chunks.push(text.slice(offset, end));
      offset = end;
    }
    return chunks;
  }

  private async replyAndRemember(
    ctx: Context,
    ...args: Parameters<Context['reply']>
  ) {
    const sent = await ctx.reply(...args);
    if (sent && ctx.chat && !this.isPrivateChat(ctx)) {
      await this.rememberContextMessage({
        chatId: ctx.chat.id,
        threadId:
          sent.message_thread_id ??
          (ctx.message && 'message_thread_id' in ctx.message
            ? ctx.message.message_thread_id
            : null) ??
          null,
        telegramMessageId: sent.message_id,
        text: sent.text,
        username: sent.from?.username || 'Баласи',
        sentAt: new Date(sent.date * 1000),
        isBot: true,
      });
    }
    return sent;
  }

  private limitRecentMessagesByChars(
    messages: ConversationMessage[],
    maxChars: number,
  ): ConversationMessage[] {
    const selected: ConversationMessage[] = [];
    let totalChars = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const estimatedChars = message.text.length + message.username.length + 24;
      if (totalChars + estimatedChars > maxChars) {
        if (selected.length === 0) {
          selected.unshift({
            ...message,
            text:
              message.text.slice(
                0,
                Math.max(0, maxChars - message.username.length - 25),
              ) + '…',
          });
        }
        break;
      }
      selected.unshift(message);
      totalChars += estimatedChars;
    }

    return selected;
  }

  private async replyWithLeaderboard(
    ctx: Context,
    messageId?: number,
  ): Promise<void> {
    const leaders = await this.dictionaryService.getLeaderboard(10);
    const message = this.formatLeaderboardMessage(leaders);

    if (messageId != null) {
      await this.replyAndRemember(ctx, message, {
        reply_parameters: { message_id: messageId },
      });
      return;
    }

    await this.replyAndRemember(ctx, message);
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

  @Command('status')
  async onStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] Received /status command`);
    const count = await this.telegramService.getCount(chatId);
    await this.replyAndRemember(
      ctx,
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
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    this.logger.log(`[Chat ${chatId}] Received /report command`);
    await this.generateReport(ctx, true);
  }

  @Command('clear')
  async onClear(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) {
      return;
    }
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    await this.telegramService.clearBuffer(chatId);
  }

  @Command('leaderboard')
  async onLeaderboard(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    await this.replyWithLeaderboard(ctx);
  }

  @Command('rules')
  async onRules(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    await this.replyAndRemember(
      ctx,
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
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    const chatId = ctx.chat!.id;
    const entries = await this.telegramService.listBotMemory(chatId, 50);
    if (entries.length === 0) {
      await this.replyAndRemember(ctx, 'Память бота пока пустая.');
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
      await this.replyAndRemember(ctx, chunk);
    }
  }

  @Command('memoryadd')
  async onMemoryAdd(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memoryadd']);
    if (!payload) {
      await this.replyAndRemember(ctx, 'Напиши так: /memoryadd что запомнить');
      return;
    }

    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';
    await this.telegramService.addBotMemory(
      chatId,
      threadId,
      payload,
      username,
    );
  }

  @Command('memoryedit')
  async onMemoryEdit(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memoryedit']);
    const parsed = payload.match(/^#?(\d+)\s+([\s\S]+)$/);
    if (!parsed || !parsed[2].trim()) {
      await this.replyAndRemember(
        ctx,
        'Напиши так: /memoryedit id новый текст',
      );
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
      await this.replyAndRemember(
        ctx,
        'Не нашёл такую запись памяти для этого чата.',
      );
      return;
    }
  }

  @Command('memorydel')
  @Hears(/^\/memorydelete(?:@\w+)?(?:\s|$)/i)
  async onMemoryDelete(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    const payload = this.getCommandPayload(ctx, ['memorydel', 'memorydelete']);
    const parsed = payload.match(/^#?(\d+)$/);
    if (!parsed) {
      await this.replyAndRemember(ctx, 'Напиши так: /memorydel id');
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
      await this.replyAndRemember(
        ctx,
        'Не нашёл такую запись памяти для этого чата.',
      );
      return;
    }
  }

  @Command('setsummarythread')
  @Hears(/^\/setSummaryThread(?:@\w+)?(?:\s|$)/)
  async onSetSummaryThread(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Команду нужно вызывать в группе (и нужном топике).',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.telegramService.setSummaryTarget(chatId, threadId, username);
  }

  @Command('clearsummarythread')
  async onClearSummaryThread(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    await this.telegramService.clearSummaryTarget();
  }

  @Command('summarythreadstatus')
  async onSummaryThreadStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const target = await this.telegramService.getSummaryTarget();
    if (!target) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Топик отчётов не настроен.\nВызови /setsummarythread в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    await this.replyAndRemember(
      ctx,
      `📍 Отчёты идут сюда:\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${formatBotDateTime(setAt)}`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('setpollchat')
  async onSetPollChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Команду нужно вызывать в группе (и нужном топике).',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.pollConfigService.set(chatId, threadId, username);
  }

  @Command('clearpollchat')
  async onClearPollChat(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    await this.pollConfigService.clear();
  }

  @Command('pollstatus')
  async onPollStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const target = await this.pollConfigService.get();
    if (!target) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Опросы не настроены.\nВызови /setpollchat в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    await this.replyAndRemember(
      ctx,
      `📍 Опросы идут сюда:\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${formatBotDateTime(setAt)}\n\n` +
        `Расписание: 8, 10, 12, 14, 16, 18, 20 МСК.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('pollnow')
  async onPollNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const target = await this.pollConfigService.get();
    if (!target) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Сначала настрой через /setpollchat.',
      );
      return;
    }
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
  }

  @Command('cleartokenreport')
  async onClearTokenReport(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;

    await this.openaiUsageService.clearReportTarget();
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
      await this.replyAndRemember(ctx, chunk);
    }
  }

  @Command('startreview')
  async onStartReview(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Вызовите команду в теме «Язык (профессионалы)».',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    const threadId =
      (ctx.message as { message_thread_id?: number }).message_thread_id ?? null;
    try {
      await this.wordReviewService.setTarget(
        chatId,
        threadId,
        ctx.from?.username ?? 'unknown',
      );
      await this.wordReviewService.sendReviewBatch({
        scheduled: true,
        chatId,
        threadId,
      });
    } catch (error) {
      this.logger.error('Could not start word review', error);
      await this.replyAndRemember(
        ctx,
        error instanceof Error &&
          error.message.startsWith('Проверка уже настроена')
          ? error.message
          : 'Не удалось завершить запуск. Сохранённый прогресс отправки будет использован при повторной попытке.',
      );
    }
  }

  @Command('setreviewchat')
  async onSetReviewChat(@Ctx() ctx: Context) {
    await this.onStartReview(ctx);
  }

  @Command('stopreview')
  async onStopReview(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Вызовите команду в теме, где идёт разбор слов.',
      );
      return;
    }
    const threadId =
      (ctx.message as { message_thread_id?: number }).message_thread_id ?? null;
    try {
      await this.wordReviewService.clearTarget(ctx.chat!.id, threadId);
    } catch (error) {
      this.logger.error('Could not stop word review', error);
      await this.replyAndRemember(
        ctx,
        'Не удалось остановить отправку. Вызовите /stopreview в теме разбора слов.',
      );
    }
  }

  @Command('clearreviewchat')
  async onClearReviewChat(@Ctx() ctx: Context) {
    await this.onStopReview(ctx);
  }

  @Command('reviewsize')
  async onReviewSize(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(ctx, 'Вызовите команду в теме разбора слов.');
      return;
    }
    const message = ctx.message as {
      text?: string;
      message_thread_id?: number;
    };
    const match = /^\S+\s+([1-9]\d*)\s*$/.exec(message.text ?? '');
    const size = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(size) || size < 1 || size > MAX_WORD_REVIEW_LIMIT) {
      await this.replyAndRemember(
        ctx,
        `Укажите целое число от 1 до ${MAX_WORD_REVIEW_LIMIT}: /reviewsize 10`,
      );
      return;
    }
    try {
      await this.wordReviewService.setBatchSize(
        ctx.chat!.id,
        message.message_thread_id ?? null,
        size,
        ctx.from?.username ?? 'unknown',
      );
    } catch (error) {
      this.logger.error('Could not change word review size', error);
      await this.replyAndRemember(
        ctx,
        'Не удалось изменить размер партии. Вызовите команду в теме разбора слов.',
      );
    }
  }

  @Command('reviewstatus')
  async onReviewStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    const status = await this.wordReviewService.getStatus();
    if (!status.target) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Проверка словаря не настроена.\nВызови /startreview в нужной теме.',
      );
      return;
    }

    const setAt =
      status.target.setAt instanceof Date
        ? status.target.setAt
        : new Date(status.target.setAt);
    const lastSent = status.lastSentAt
      ? formatBotDateTime(new Date(status.lastSentAt))
      : 'ещё не отправляли';

    await this.replyAndRemember(
      ctx,
      `📍 Проверка словаря идёт сюда:\n` +
        `chat_id: <code>${status.target.chatId}</code>\n` +
        `thread_id: <code>${status.target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${status.target.setBy}\n` +
        `когда: ${formatBotDateTime(setAt)}\n\n` +
        `Состояние: ${status.target.enabled ? 'запущено' : 'пауза'}\n` +
        `Размер партии: ${status.target.batchSize}\n` +
        `Расписание: ${WORD_REVIEW_SCHEDULE_LABEL}\n` +
        `Ближайшая отправка: ${status.target.enabled && status.target.nextRunAt ? formatReviewDate(new Date(status.target.nextRunAt)) : 'не запланирована'}\n` +
        `Слов в списке разбора: ${status.totalWords}\n` +
        `Включено в партии: ${status.sentWordCount}\n` +
        `Осталось отправить в текущем проходе: ${status.remainingWordCount}\n` +
        `Новых слов на следующий проход: ${status.waitingNextPassCount}\n` +
        `Разобрано слов: ${status.confirmedWordCount}\n` +
        `Спорных слов: ${status.disputedWordCount}\n` +
        `Ожидают завершения разбора (включая спорные): ${status.openWordCount}\n` +
        `Последняя отправка: ${lastSent}`,
      { parse_mode: 'HTML' },
    );

    await this.replyAndRemember(
      ctx,
      `Опубликовано партий: ${status.publishedBatchCount}. Полностью разобрано: ${status.completedBatchCount}.` +
        (status.sendingBatchId
          ? ` Сейчас отправляется партия №${status.sendingBatchId}.`
          : '') +
        '\nОбсуждение предыдущих партий не задерживает новые отправки.',
    );
  }

  @Command('reviewnow')
  async onReviewNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }

    try {
      const result = await this.wordReviewService.sendReviewBatch({
        extra: true,
        chatId: ctx.chat!.id,
        threadId:
          (ctx.message as { message_thread_id?: number }).message_thread_id ??
          null,
      });
      if (result.status === 'no_target') {
        await this.replyAndRemember(
          ctx,
          '⚠️ Сначала запустите разбор через /startreview.',
        );
        return;
      }
    } catch (err) {
      this.logger.error('Manual word review failed', err);
      await this.replyAndRemember(ctx, 'Ошибка при отправке слов на проверку.');
    }
  }

  @Command('startfactday')
  async onStartFactDay(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Команду нужно вызывать в группе (и нужном топике).',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    const username = ctx.from?.username || 'unknown';

    await this.factDayConfigService.set(chatId, threadId, username);
  }

  @Command('stopfactday')
  async onStopFactDay(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const disabled = await this.factDayConfigService.disable();
    if (!disabled) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Исторический квиз ещё не настроен. Включи через /startfactday в нужном топике.',
      );
      return;
    }
  }

  @Command('factdaystatus')
  async onFactDayStatus(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const target = await this.factDayConfigService.get();
    if (!target) {
      await this.replyAndRemember(
        ctx,
        '⚠️ Исторический квиз не настроен.\nВызови /startfactday в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    const quizCount = this.factDayScheduler.getFactsCount();
    const nextQuizNumber =
      (((target.nextFactIndex % quizCount) + quizCount) % quizCount) + 1;
    // Slots store the Tbilisi date/hour, sometimes with midnight as hour 24.
    // They determine the Moscow date without inventing an exact sending time.
    const lastSlot = /^(\d{4}-\d{2}-\d{2})-(\d{2})$/.exec(
      target.lastSentSlot ?? '',
    );
    const lastSentDate = lastSlot
      ? formatBotDate(
          new Date(
            `${lastSlot[1]}T${lastSlot[2] === '24' ? '00' : lastSlot[2]}:00:00+04:00`,
          ),
        )
      : (target.lastSentDate ?? 'ещё не было');
    await this.replyAndRemember(
      ctx,
      `📍 Исторический квиз:\n` +
        `статус: ${target.enabled === false ? 'отключён' : 'включён'}\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${formatBotDateTime(setAt)}\n\n` +
        `следующий вопрос: ${nextQuizNumber}/${quizCount}\n` +
        `последняя отправка: ${lastSentDate}\n` +
        `расписание: ${FACT_DAY_SCHEDULE_LABEL}.`,
      { parse_mode: 'HTML' },
    );
  }

  @Command('factdaynow')
  async onFactDayNow(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Этот бот работает только в групповых чатах.',
      );
      return;
    }
    const result = await this.factDayScheduler.sendNext(true);
    if (result.sent) {
      return;
    }
    if (result.reason === 'not_configured') {
      await this.replyAndRemember(
        ctx,
        '⚠️ Сначала настрой через /startfactday.',
      );
      return;
    }
    if (result.reason === 'disabled') {
      await this.replyAndRemember(
        ctx,
        '⚠️ Исторический квиз отключён. Включи через /startfactday.',
      );
      return;
    }
    await this.replyAndRemember(
      ctx,
      '❌ Не получилось отправить исторический квиз. Проверь логи бота.',
    );
  }

  @Command('threadid')
  async onThreadId(@Ctx() ctx: Context) {
    if (!(await this.requireAdmin(ctx))) return;
    if (this.isPrivateChat(ctx)) {
      await this.replyAndRemember(
        ctx,
        'Команду нужно вызывать в группе (и нужном топике).',
      );
      return;
    }
    const chatId = ctx.chat!.id;
    const message = ctx.message as { message_thread_id?: number };
    const threadId = message.message_thread_id ?? null;
    await this.replyAndRemember(
      ctx,
      `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>`,
      { parse_mode: 'HTML' },
    );
  }

  private async generateReport(
    ctx: Context,
    notifyRepeatedFailure = false,
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const sourceMessage = ctx.message as { message_thread_id?: number };
    const sourceThreadId = sourceMessage?.message_thread_id ?? null;
    let stage: ReportGenerationStage = 'load_messages';

    try {
      const storedMessages =
        await this.telegramService.getActiveMessages(chatId);
      const messagesText = storedMessages.map((m) => m.text);
      const summaryLinks = new Map<
        string,
        { url: string; username: string; number: number }
      >();
      const messages = storedMessages.map((m, index) => {
        const ref = `m${index + 1}`;
        const link = this.buildTelegramMessageLink(
          m.chatId,
          m.telegramMessageId,
        );
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
        this.reportFailureNotifications.delete(chatId);
        await this.replyAndRemember(ctx, 'Сообщений пока нет.');
        return;
      }

      stage = 'load_target';
      const summaryTarget = await this.telegramService.getSummaryTarget();
      const target = summaryTarget ?? {
        chatId,
        threadId: sourceThreadId,
      };

      stage = 'openai_analysis';
      const analysis = await this.openaiService.analyzeDiscussion(messages);
      const words = analysis.words;
      const discussionResult = analysis.discussionResult;

      stage = 'format_report';
      let report = await this.formatReport(words);
      const summary = this.shortenDiscussionSummary(
        discussionResult.discussionSummary || '',
      );
      if (summary) {
        report +=
          '\n\n---\n\n📝 <b>КОРОТКОЕ САММАРИ:</b>\n' +
          this.formatDiscussionSummary(summary, summaryLinks);
      }

      stage = 'save_report';
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

      stage = 'send_report';
      await this.sendReportToTarget(target.chatId, target.threadId, report);

      stage = 'mark_messages';
      await this.telegramService.markMessagesReported(
        storedMessages.map((m) => m.id),
        savedReport.id,
      );
      this.reportFailureNotifications.delete(chatId);
    } catch (error) {
      this.logDetailedError(
        `[Chat ${chatId}] Report failed at stage ${stage}`,
        error,
      );
      const failure = this.buildReportFailure(stage, error);
      const previousFingerprint = this.reportFailureNotifications.get(chatId);
      this.reportFailureNotifications.set(chatId, failure.fingerprint);
      if (
        notifyRepeatedFailure ||
        previousFingerprint !== failure.fingerprint
      ) {
        await this.replyAndRemember(ctx, failure.message);
      }
    }
  }

  private buildReportFailure(
    stage: ReportGenerationStage,
    error: unknown,
  ): ReportFailure {
    const details = this.getErrorDetails(error);
    const stageLabels: Record<ReportGenerationStage, string> = {
      load_messages: 'загрузка сообщений из базы данных',
      load_target: 'загрузка настроек отчёта из базы данных',
      openai_analysis: 'анализ сообщений через OpenAI',
      format_report: 'сверка слов со словарём и формирование отчёта',
      save_report: 'сохранение отчёта в базе данных',
      send_report: 'отправка отчёта в Telegram',
      mark_messages: 'отметка сообщений как обработанных в базе данных',
    };

    let reason: string;
    if (stage === 'openai_analysis') {
      reason = this.describeOpenAiFailureForUser(error);
    } else if (stage === 'send_report') {
      reason = this.describeTelegramFailureForUser(details);
    } else if (
      stage === 'load_messages' ||
      stage === 'load_target' ||
      stage === 'save_report' ||
      stage === 'mark_messages'
    ) {
      reason = details.code
        ? `ошибка базы данных (код: ${this.safeDiagnosticValue(details.code)})`
        : 'ошибка доступа к базе данных';
    } else {
      reason = details.code
        ? `внутренняя ошибка (код: ${this.safeDiagnosticValue(details.code)})`
        : 'внутренняя ошибка формирования отчёта';
    }

    const recovery =
      stage === 'mark_messages'
        ? 'Отчёт мог быть отправлен, но сообщения не отмечены обработанными; перед повтором проверьте чат отчётов.'
        : 'Исходные сообщения сохранены. После устранения причины повторите /report.';
    const fingerprint = [
      stage,
      details.status ?? '',
      details.code ?? '',
      details.type ?? '',
      details.telegramCode ?? '',
    ].join(':');

    return {
      fingerprint,
      message:
        `❌ Не удалось создать отчёт.\n` +
        `Этап: ${stageLabels[stage]}.\n` +
        `Причина: ${reason}.\n` +
        `${recovery}\n` +
        `Подробности записаны в логах бота.`,
    };
  }

  private describeOpenAiFailureForUser(error: unknown): string {
    const details = this.getErrorDetails(error);
    const message = details.message?.toLowerCase() ?? '';
    const code = details.code?.toLowerCase() ?? '';
    let reason: string;

    if (
      details.status === 429 &&
      (code.includes('quota') || message.includes('quota'))
    ) {
      reason = 'исчерпана квота OpenAI';
    } else if (details.status === 429) {
      reason = 'OpenAI ограничил частоту запросов';
    } else if (details.status === 401) {
      reason = 'ключ OpenAI отсутствует или недействителен';
    } else if (details.status === 403) {
      reason = 'у проекта нет доступа к запрошенной модели OpenAI';
    } else if (details.status === 404) {
      reason = 'модель или endpoint OpenAI не найдены';
    } else if (
      details.status === 408 ||
      code.includes('timeout') ||
      /timed?\s*out|etimedout/.test(message)
    ) {
      reason = 'истекло время ожидания ответа OpenAI';
    } else if (details.status != null && details.status >= 500) {
      reason = 'временный сбой на стороне OpenAI';
    } else if (/connection|econn|fetch failed|socket|network/.test(message)) {
      reason = 'не удалось подключиться к OpenAI';
    } else {
      reason = 'запрос к OpenAI завершился ошибкой';
    }

    const diagnostics: string[] = [];
    if (details.status != null) {
      diagnostics.push(`HTTP ${details.status}`);
    }
    if (details.code) {
      diagnostics.push(`код: ${this.safeDiagnosticValue(details.code)}`);
    } else if (details.type) {
      diagnostics.push(`тип: ${this.safeDiagnosticValue(details.type)}`);
    }
    if (details.requestId) {
      diagnostics.push(
        `request_id: ${this.safeDiagnosticValue(details.requestId)}`,
      );
    }

    return diagnostics.length > 0
      ? `${reason} (${diagnostics.join(', ')})`
      : reason;
  }

  private describeTelegramFailureForUser(details: ErrorDetails): string {
    const diagnostics: string[] = [];
    if (details.telegramCode != null) {
      diagnostics.push(`код Telegram: ${details.telegramCode}`);
    } else if (details.status != null) {
      diagnostics.push(`HTTP ${details.status}`);
    }
    if (details.telegramDescription) {
      diagnostics.push(
        this.safeDiagnosticValue(details.telegramDescription, 180),
      );
    }
    return diagnostics.length > 0
      ? `Telegram отклонил сообщение (${diagnostics.join(', ')})`
      : 'не удалось отправить сообщение через Telegram';
  }

  private getErrorDetails(error: unknown): ErrorDetails {
    const record =
      typeof error === 'object' && error !== null
        ? (error as Record<string, unknown>)
        : null;
    const cause =
      record && typeof record.cause === 'object' && record.cause !== null
        ? (record.cause as Record<string, unknown>)
        : null;
    const driverError =
      record &&
      typeof record.driverError === 'object' &&
      record.driverError !== null
        ? (record.driverError as Record<string, unknown>)
        : null;
    const apiError =
      record && typeof record.error === 'object' && record.error !== null
        ? (record.error as Record<string, unknown>)
        : null;
    const response =
      record && typeof record.response === 'object' && record.response !== null
        ? (record.response as Record<string, unknown>)
        : null;
    const readString = (...values: unknown[]): string | null => {
      for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
      return null;
    };
    const readNumber = (...values: unknown[]): number | null => {
      for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) return value;
      }
      return null;
    };

    return {
      name: readString(
        record?.name,
        error instanceof Error ? error.name : null,
      ),
      message: readString(
        record?.message,
        apiError?.message,
        driverError?.message,
        cause?.message,
        error instanceof Error ? error.message : null,
        typeof error === 'string' ? error : null,
      ),
      status: readNumber(record?.status, apiError?.status, response?.status),
      code: readString(
        record?.code,
        apiError?.code,
        driverError?.code,
        cause?.code,
      ),
      type: readString(record?.type, apiError?.type),
      requestId: readString(
        record?.request_id,
        record?.requestId,
        record?.requestID,
        apiError?.request_id,
      ),
      telegramCode: readNumber(response?.error_code, record?.error_code),
      telegramDescription: readString(
        response?.description,
        record?.description,
      ),
    };
  }

  private logDetailedError(context: string, error: unknown): void {
    const details = this.getErrorDetails(error);
    const fields = [
      details.name ? `name=${this.safeDiagnosticValue(details.name)}` : null,
      details.status != null ? `status=${details.status}` : null,
      details.code ? `code=${this.safeDiagnosticValue(details.code)}` : null,
      details.type ? `type=${this.safeDiagnosticValue(details.type)}` : null,
      details.requestId
        ? `request_id=${this.safeDiagnosticValue(details.requestId)}`
        : null,
      details.telegramCode != null
        ? `telegram_code=${details.telegramCode}`
        : null,
      details.telegramDescription
        ? `telegram_description=${this.safeDiagnosticValue(
            details.telegramDescription,
            300,
          )}`
        : null,
      details.message
        ? `message=${this.safeDiagnosticValue(details.message, 500)}`
        : null,
    ].filter((field): field is string => field != null);
    const stack =
      error instanceof Error && error.stack
        ? this.redactSensitiveErrorText(error.stack)
        : undefined;
    this.logger.error(
      `${context}${fields.length > 0 ? ` | ${fields.join(' | ')}` : ''}`,
      stack,
    );
  }

  private safeDiagnosticValue(value: string, maxLength = 100): string {
    return this.redactSensitiveErrorText(value)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private redactSensitiveErrorText(value: string): string {
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_OPENAI_KEY]')
      .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
      .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@');
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
