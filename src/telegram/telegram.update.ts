import { Update, Ctx, Hears, Command, Start, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { TelegramService } from './telegram.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import { OpenaiService } from '../openai/openai.service';
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
        '/clear - Очистить буфер без отчёта',
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
    const message = ctx.message as { text: string; from?: { username?: string } };
    const text = message.text;
    this.logger.log(`[Chat ${chatId}] Received text: "${text}"`);

    const username = message.from?.username || 'anonymous';
    const count = this.telegramService.addMessage(chatId, text, username);
    this.logger.log(`[Chat ${chatId}] Message count: ${count}/${this.threshold}`);

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
    const count = this.telegramService.getCount(chatId);
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
    this.telegramService.clearBuffer(chatId);
    await ctx.reply('🗑 Буфер очищен.');
  }

  private async generateReport(ctx: Context) {
    const chatId = ctx.chat!.id;
    const messagesText = this.telegramService.getMessagesText(chatId);
    const messages = this.telegramService.getMessages(chatId);

    if (messagesText.length === 0) {
      await ctx.reply('Сообщений пока нет.');
      return;
    }

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

      await ctx.deleteMessage(statusMsg.message_id);

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

      if (report.length > 4000) {
        const chunks = this.chunkString(report, 4000);
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          const text = isLast
            ? chunks[i] + '\n\n✅ Отчёт готов, буфер очищен.'
            : chunks[i];
          await ctx.reply(text, { parse_mode: 'HTML' });
        }
      } else {
        await ctx.reply(report + '\n\n✅ Отчёт готов, буфер очищен.', {
          parse_mode: 'HTML',
        });
      }

      this.telegramService.clearBuffer(chatId);
    } catch (error) {
      this.logger.error('Report error:', error);
      await ctx.reply('❌ Ошибка при формировании отчёта. Попробуйте ещё раз.');
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

    const sectionLines = (
      items: string[],
      emptyLabel = '— нет',
    ): string => (items.length > 0 ? items.join('\n') : emptyLabel);

    const dictionaryLines = fromDictionary.map(
      (item, index) => `${index + 1}. <b>${item.word}</b> — ${item.translation}`,
    );
    const translatedLines = translated.map(
      (item, index) => `${index + 1}. <b>${item.word}</b> — ${item.translation}`,
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
