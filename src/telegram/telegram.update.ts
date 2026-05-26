import { Update, Ctx, Hears, Command, Start, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { BotMemoryEntry, TelegramService } from './telegram.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import {
  DictionaryEntryInput,
  DictionaryUpdateInput,
  OpenaiService,
} from '../openai/openai.service';
import { PollConfigService } from '../poll/poll-config.service';
import { PollSchedulerService } from '../poll/poll-scheduler.service';
import { FactDayConfigService } from '../fact-day/fact-day-config.service';
import {
  FACT_DAY_SCHEDULE_LABEL,
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
        '/startfactday - Запустить исторический квиз в этом топике\n' +
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
  private static readonly MAX_UPDATE_BATCH = 5;

  private static readonly BOT_CONTEXT_MESSAGE_LIMIT = 50;

  private static readonly BOT_MEMORY_LIMIT = 50;

  private static readonly WORKING_LINKS_REQUEST_REGEX =
    /(?:рабоч\w*\s+ссыл|ссылк\w*[\s\S]{0,40}рабоч|скин\w*[\s\S]{0,40}ссыл|пришл\w*[\s\S]{0,40}ссыл|дай[\s\S]{0,40}ссыл)/i;

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

    const directDictionaryUpdate = this.extractDirectDictionaryUpdate(text);
    if (directDictionaryUpdate) {
      await this.handleDictionaryUpdates(ctx, chatId, username, messageId, [
        directDictionaryUpdate,
      ]);
      return;
    }

    const directDictionaryEntries = this.extractDirectDictionaryEntries(text);
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
    await this.handleDictionaryAdditions(
      ctx,
      chatId,
      username,
      messageId,
      result.entries,
    );
  }

  private extractDirectDictionaryEntries(text: string): DictionaryEntryInput[] {
    const body = text.replace(TelegramUpdate.BOT_MENTION_REGEX, '').trim();
    const entries: DictionaryEntryInput[] = [];
    const seen = new Set<string>();

    for (const line of body.split(/\r?\n/g)) {
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

  private extractDictionaryEntryLine(
    line: string,
  ): DictionaryEntryInput | null {
    const trimmed = this.stripDictionaryPairIntent(
      line.trim().replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''),
    );
    const match = trimmed.match(/^(.+?)\s+(?:[-—=])\s+(.+?)\s*;?\s*$/);
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
      !/[@#/:\\\d]/.test(word)
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

    for (const entry of entries) {
      try {
        const upserted = await this.dictionaryService.upsertWord({
          word: entry.word,
          translation: entry.translation,
          partOfSpeech: entry.partOfSpeech,
          addedBy: username,
        });
        const posTag = entry.partOfSpeech ? ` (${entry.partOfSpeech})` : '';
        const line = `${upserted.word.word} — ${entry.translation}${posTag}`;
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

      if (created.length + expanded.length > 0) {
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
    return value
      .toLowerCase()
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}]+$/g, '')
      .replace(/\s+/g, ' ');
  }

  private cleanDictionaryTranslation(value: string): string {
    return value
      .trim()
      .replace(/^[\s"'«»“”„`.,;:!?()[\]{}]+/g, '')
      .replace(/[\s"'«»“”„`.,;:!?()[\]{}]+$/g, '')
      .replace(/\s+/g, ' ');
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

    if (updated.length > 0) {
      try {
        await ctx.telegram.setMessageReaction(chatId, messageId, [
          { type: 'emoji', emoji: '👍' },
        ]);
      } catch (err) {
        this.logger.warn(`Failed to set reaction: ${err}`);
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
      const [words, discussionResult] = await Promise.all([
        this.openaiService.analyzeMessages(messagesText),
        this.openaiService.processDiscussion(messages),
      ]);

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
