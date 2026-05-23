import { Update, Ctx, Hears, Command, Start, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { BotMemoryEntry, TelegramService } from './telegram.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { OpenaiService } from '../openai/openai.service';
import { PollConfigService } from '../poll/poll-config.service';
import { PollSchedulerService } from '../poll/poll-scheduler.service';
import { FactDayConfigService } from '../fact-day/fact-day-config.service';
import {
  FACT_DAY_TZ,
  FactDaySchedulerService,
} from '../fact-day/fact-day-scheduler.service';
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
    private factDayConfigService: FactDayConfigService,
    private factDayScheduler: FactDaySchedulerService,
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
      { command: 'leaderboard', description: 'Топ добавивших слова' },
      {
        command: 'startfactday',
        description: 'Запустить факт дня в этом топике',
      },
      { command: 'stopfactday', description: 'Отключить факт дня' },
      { command: 'factdaystatus', description: 'Куда сейчас идёт факт дня' },
      { command: 'factdaynow', description: 'Отправить факт дня сейчас' },
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
        '/startfactday - Запустить факт дня в этом топике\n' +
        '/leaderboard - Топ добавивших слова\n' +
        '/memory - Память бота',
    );
  }

  private isPrivateChat(ctx: Context): boolean {
    return ctx.chat?.type === 'private';
  }

  private isAdmin(username: string | undefined): boolean {
    return username === 'AAlxnv' || username === 'MEMazmanova';
  }

  private async requireAdmin(ctx: Context): Promise<boolean> {
    const isAdmin = this.isAdmin(ctx.from?.username);
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
    const username = message.from?.username || 'anonymous';

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

  private static readonly BOT_MENTION_REGEX = /^\s*(?:бот|баласи)[\s,:!.\-—]/i;
  private static readonly MAX_DELETE_BATCH = 10;

  private static readonly BOT_CONTEXT_MESSAGE_LIMIT = 50;

  private static readonly BOT_MEMORY_LIMIT = 50;

  private static readonly WORKING_LINKS_REQUEST_REGEX =
    /(?:рабоч\w*\s+ссыл|ссылк\w*[\s\S]{0,40}рабоч|скин\w*[\s\S]{0,40}ссыл|пришл\w*[\s\S]{0,40}ссыл|дай[\s\S]{0,40}ссыл)/i;

  private static readonly LEADERBOARD_REQUEST_REGEX =
    /(?:лидер|топ|рейтинг|таблиц\w*\s+лидер|кто\s+(?:больше|больше\s+всех|больше\s+всего|много)[\s\S]{0,40}(?:слов|слова|добав)|кто[\s\S]{0,40}(?:добавил|добавляет)[\s\S]{0,40}(?:слов|слова))/i;

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

    if (this.isLeaderboardRequest(text)) {
      await this.replyWithLeaderboard(ctx, messageId);
      return;
    }

    const [recentMessages, botMemory] = await Promise.all([
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
    this.logger.log(
      `[Chat ${chatId}] Loaded ${recentMessages.length} recent messages and ${botMemory.length} memory entries for AI context`,
    );

    if (this.isWorkingLinksRequest(text)) {
      await this.replyWithWorkingLinks(ctx, messageId, botMemory);
      return;
    }

    let result;
    try {
      result = await this.openaiService.processBotMention(
        text,
        recentMessages,
        botMemory,
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

    if (result.action === 'delete_words') {
      if (!this.isAdmin(username)) {
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

          if (deleted.length > 0) {
            try {
              await ctx.telegram.setMessageReaction(chatId, messageId, [
                { type: 'emoji', emoji: '👍' },
              ]);
            } catch (err) {
              this.logger.warn(`Failed to set reaction: ${err}`);
            }
          }
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
    const created: string[] = [];
    const updated: string[] = [];
    const failed: { word: string; err: unknown }[] = [];

    for (const entry of result.entries) {
      try {
        const upserted = await this.dictionaryService.upsertWord({
          word: entry.word,
          translation: entry.translation,
          partOfSpeech: entry.partOfSpeech,
          addedBy: username,
        });
        const posTag = entry.partOfSpeech ? ` (${entry.partOfSpeech})` : '';
        const line = `${entry.word} — ${entry.translation}${posTag}`;
        (upserted.created ? created : updated).push(line);
        this.logger.log(
          `[Chat ${chatId}] Dictionary ${upserted.created ? 'created' : 'updated'} by @${username}: ${entry.word} = ${entry.translation}${posTag}`,
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
      if (updated.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(
          updated.length === 1
            ? `🔄 обновил:`
            : `🔄 обновил (${updated.length}):`,
        );
        for (const l of updated) lines.push(`• ${l}`);
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

      if (created.length + updated.length > 0) {
        try {
          await ctx.telegram.setMessageReaction(chatId, messageId, [
            { type: 'emoji', emoji: '👍' },
          ]);
        } catch (err) {
          this.logger.warn(`Failed to set reaction: ${err}`);
        }
      }
    }
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
    if (!this.isAdmin(username)) {
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
      `✅ Рубрика "Факт дня из истории Цинцкаро" запущена в этом топике.\n` +
        `chat_id: <code>${chatId}</code>\n` +
        `thread_id: <code>${threadId ?? 'нет (общий чат)'}</code>\n\n` +
        `Расписание: каждый день в 11:00 (${FACT_DAY_TZ}).\n` +
        `Всего фактов: ${this.factDayScheduler.getFactsCount()}.`,
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
        '⚠️ Факт дня ещё не настроен. Включи через /startfactday в нужном топике.',
      );
      return;
    }
    await ctx.reply(
      '🛑 Факт дня отключён. Настройка сохранена, включить снова можно через /startfactday.',
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
        '⚠️ Факт дня не настроен.\nВызови /startfactday в нужном топике.',
      );
      return;
    }
    const setAt =
      target.setAt instanceof Date ? target.setAt : new Date(target.setAt);
    const factsCount = this.factDayScheduler.getFactsCount();
    const nextFactNumber =
      (((target.nextFactIndex % factsCount) + factsCount) % factsCount) + 1;
    await ctx.reply(
      `📍 Факт дня:\n` +
        `статус: ${target.enabled === false ? 'отключён' : 'включён'}\n` +
        `chat_id: <code>${target.chatId}</code>\n` +
        `thread_id: <code>${target.threadId ?? 'нет (общий чат)'}</code>\n` +
        `настроил: @${target.setBy}\n` +
        `когда: ${setAt.toISOString()}\n\n` +
        `следующий факт: ${nextFactNumber}/${factsCount}\n` +
        `последняя отправка: ${target.lastSentDate ?? 'ещё не было'}\n` +
        `расписание: каждый день в 11:00 (${FACT_DAY_TZ}).`,
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
      await ctx.reply(`✅ Отправил факт ${result.factNumber}.`);
      return;
    }
    if (result.reason === 'not_configured') {
      await ctx.reply('⚠️ Сначала настрой через /startfactday.');
      return;
    }
    if (result.reason === 'disabled') {
      await ctx.reply('⚠️ Факт дня отключён. Включи через /startfactday.');
      return;
    }
    await ctx.reply('❌ Не получилось отправить факт дня. Проверь логи бота.');
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

    try {
      const [words, discussionResult] = await Promise.all([
        this.openaiService.analyzeMessages(messagesText),
        this.openaiService.processDiscussion(messages),
      ]);

      let report = await this.formatReport(words);
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
