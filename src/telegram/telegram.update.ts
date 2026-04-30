import { Update, Ctx, Hears, Command, Start, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { TelegramService } from './telegram.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { OpenaiService } from '../openai/openai.service';
import { PollConfigService } from '../poll/poll-config.service';
import { PollSchedulerService } from '../poll/poll-scheduler.service';
import { ConfigService } from '@nestjs/config';
import { Logger, OnModuleInit } from '@nestjs/common';

@Update()
export class TelegramUpdate implements OnModuleInit {
  private readonly threshold: number;
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(
    @InjectBot() private bot: Telegraf<Context>,
    private telegramService: TelegramService,
    private openaiService: OpenaiService,
    private dictionaryService: DictionaryService,
    private pollConfigService: PollConfigService,
    private pollScheduler: PollSchedulerService,
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
      { command: 'threadid', description: 'Показать chat_id и thread_id' },
    ]);
    this.logger.log('Bot commands registered');
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
        '/setsummarythread - Слать отчёты в этот топик',
    );
  }

  private isPrivateChat(ctx: Context): boolean {
    return ctx.chat?.type === 'private';
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const username = ctx.from?.username;
    const isAdmin = username === 'AAlxnv' || username === 'MEMazmanova';
    if (!isAdmin) {
      await ctx.reply('Команды боту доступны только администраторам');
    }
    return isAdmin;
  }

  @Hears(/^[^\/]/)
  async onText(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) return;
    if (ctx.from?.is_bot) return; // Игнорировать сообщения от ботов

    const chatId = ctx.chat!.id;
    const message = ctx.message as {
      message_id?: number;
      text: string;
      from?: { username?: string };
      message_thread_id?: number;
      date?: number;
    };
    const text = message.text;
    const threadId = message.message_thread_id;
    this.logger.log(
      `[Chat ${chatId}${threadId ? ` / thread ${threadId}` : ''}] Received text: "${text}"`,
    );

    const username = message.from?.username || 'anonymous';
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
    await ctx.reply('🚀 Отправляю пару опросов (с задержкой 30 секунд)...');
    await this.pollScheduler.sendBoth();
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
    const messages = storedMessages.map((m) => ({
      text: m.text,
      username: m.username,
    }));

    if (messagesText.length === 0) {
      await ctx.reply('Сообщений пока нет.');
      return;
    }

    const summaryTarget = await this.telegramService.getSummaryTarget();
    const target = summaryTarget ?? {
      chatId,
      threadId: sourceThreadId,
    };

    const countWord = this.pluralize(
      messagesText.length,
      'сообщение',
      'сообщения',
      'сообщений',
    );
    const statusMsg = await ctx.reply(
      `🔍 Анализирую ${messagesText.length} ${countWord}...`,
    );

    try {
      const [words, discussionResult] = await Promise.all([
        this.openaiService.analyzeMessages(messagesText),
        this.openaiService.processDiscussion(messages),
      ]);

      await this.deleteMessageIfPossible(ctx, statusMsg.message_id);

      let report = this.formatReport(words);
      const summary = discussionResult.discussionSummary || '';
      if (summary) {
        const escapedSummary = summary
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        report +=
          '\n\n---\n\n📝 <b>ПОДРОБНОЕ ОПИСАНИЕ ОБСУЖДЕНИЯ:</b>\n' +
          escapedSummary;
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

      if (
        summaryTarget &&
        (summaryTarget.chatId !== chatId ||
          (summaryTarget.threadId ?? null) !== sourceThreadId)
      ) {
        await ctx.reply(
          '✅ Отчёт отправлен в настроенный топик, буфер очищен.',
        );
      }
    } catch (error) {
      this.logger.error('Report error:', error);
      await ctx.reply('❌ Ошибка при формировании отчёта. Попробуйте ещё раз.');
    }
  }

  private async sendReportToTarget(
    chatId: number,
    threadId: number | null,
    report: string,
  ): Promise<void> {
    if (report.length > 4000) {
      const chunks = this.chunkString(report, 4000);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        const text = isLast
          ? chunks[i] + '\n\n✅ Отчёт готов, буфер очищен.'
          : chunks[i];
        await this.bot.telegram.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          message_thread_id: threadId ?? undefined,
        });
      }
      return;
    }

    await this.bot.telegram.sendMessage(
      chatId,
      report + '\n\n✅ Отчёт готов, буфер очищен.',
      {
        parse_mode: 'HTML',
        message_thread_id: threadId ?? undefined,
      },
    );
  }

  private async deleteMessageIfPossible(
    ctx: Context,
    messageId: number,
  ): Promise<void> {
    try {
      await ctx.deleteMessage(messageId);
    } catch (error) {
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

  private formatReport(
    words: Array<{
      word: string;
      possibleTranslation: string | null;
      context: string;
    }>,
  ): string {
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

    uniqueWords.forEach((w) => {
      const dictionaryEntry = this.dictionaryService.findWord(w.word);
      if (dictionaryEntry) {
        fromDictionary.push({
          word: w.word,
          translation: dictionaryEntry.translation,
        });
        return;
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
    });

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
