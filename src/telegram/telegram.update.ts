import { Update, Ctx, Hears, Command, Start, InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { TelegramService } from './telegram.service';
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

  @Hears(/^[^\/]/)
  async onText(@Ctx() ctx: Context) {
    if (this.isPrivateChat(ctx)) return;

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
    const messages = this.telegramService.getMessagesText(chatId);

    if (messages.length === 0) {
      await ctx.reply('Сообщений пока нет.');
      return;
    }

    const countWord = this.pluralize(messages.length, 'сообщение', 'сообщения', 'сообщений');
    const statusMsg = await ctx.reply(`🔍 Анализирую ${messages.length} ${countWord}...`);

    try {
      const words = await this.openaiService.analyzeMessages(messages);

      // Delete the "analyzing" message
      await ctx.deleteMessage(statusMsg.message_id);

      if (words.length === 0) {
        await ctx.reply('Цинцкарских слов не найдено.');
      } else {
        const report = this.formatReport(words);

        if (report.length > 4000) {
          const chunks = this.chunkString(report, 4000);
          for (let i = 0; i < chunks.length; i++) {
            // Add footer only to last chunk
            const isLast = i === chunks.length - 1;
            const text = isLast ? chunks[i] + '\n\n✅ Отчёт готов, буфер очищен.' : chunks[i];
            await ctx.reply(text, { parse_mode: 'HTML' });
          }
        } else {
          await ctx.reply(report + '\n\n✅ Отчёт готов, буфер очищен.', { parse_mode: 'HTML' });
        }
      }

      this.telegramService.clearBuffer(chatId);
    } catch (error) {
      console.error('Analysis error:', error);
      await ctx.reply('❌ Ошибка при анализе. Попробуйте ещё раз.');
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
    let report = '📖 <b>СЛОВАРЬ ЦИНЦКАРО</b>\n\n';

    words.forEach((w, i) => {
      const translation = w.possibleTranslation || 'не могу перевести';
      report += `${i + 1}. <b>${w.word}</b> - ${translation}\n`;
    });

    report += `\n📝 Найдено слов: ${words.length}`;
    return report;
  }

  private chunkString(str: string, size: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }
}
