import { Update, Ctx, On, Command, Start } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramService } from './telegram.service';
import { OpenaiService } from '../openai/openai.service';
import { ConfigService } from '@nestjs/config';

@Update()
export class TelegramUpdate {
  private readonly threshold: number;

  constructor(
    private telegramService: TelegramService,
    private openaiService: OpenaiService,
    private config: ConfigService,
  ) {
    this.threshold = this.config.get('messageThreshold') || 100;
  }

  @Start()
  async onStart(@Ctx() ctx: Context) {
    await ctx.reply(
      'Სალამი! I am the Tsintskaro Dictionary Bot.\n\n' +
        'I collect messages and extract non-Russian words for the dictionary.\n\n' +
        'Commands:\n' +
        '/report - Generate report now\n' +
        '/status - Show collected message count\n' +
        '/clear - Clear buffer without report',
    );
  }

  @On('text')
  async onText(@Ctx() ctx: Context) {
    const message = ctx.message as { text: string; from?: { username?: string } };
    const text = message.text;

    if (text.startsWith('/')) return;

    const username = message.from?.username || 'anonymous';
    const count = this.telegramService.addMessage(text, username);

    if (count >= this.threshold) {
      await this.generateReport(ctx);
    }
  }

  @Command('status')
  async onStatus(@Ctx() ctx: Context) {
    const count = this.telegramService.getCount();
    await ctx.reply(
      `📊 Collected messages: ${count}/${this.threshold}\n` +
        `Use /report to generate report now.`,
    );
  }

  @Command('report')
  async onReport(@Ctx() ctx: Context) {
    await this.generateReport(ctx);
  }

  @Command('clear')
  async onClear(@Ctx() ctx: Context) {
    this.telegramService.clearBuffer();
    await ctx.reply('🗑 Buffer cleared.');
  }

  private async generateReport(ctx: Context) {
    const messages = this.telegramService.getMessagesText();

    if (messages.length === 0) {
      await ctx.reply('No messages collected yet.');
      return;
    }

    await ctx.reply(`🔍 Analyzing ${messages.length} messages...`);

    try {
      const words = await this.openaiService.analyzeMessages(messages);

      if (words.length === 0) {
        await ctx.reply('No non-Russian words found in this batch.');
      } else {
        const report = this.formatReport(words);

        if (report.length > 4000) {
          const chunks = this.chunkString(report, 4000);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: 'HTML' });
          }
        } else {
          await ctx.reply(report, { parse_mode: 'HTML' });
        }
      }

      this.telegramService.clearBuffer();
      await ctx.reply(`✅ Report complete. Buffer cleared.`);
    } catch (error) {
      console.error('Analysis error:', error);
      await ctx.reply('❌ Error during analysis. Please try again.');
    }
  }

  private formatReport(
    words: Array<{
      word: string;
      possibleTranslation: string | null;
      context: string;
    }>,
  ): string {
    let report = '📖 <b>TSINTSKARO DICTIONARY REPORT</b>\n\n';

    words.forEach((w, i) => {
      report += `<b>${i + 1}. ${w.word}</b>\n`;
      report += `   Translation: ${w.possibleTranslation || '❓ unknown'}\n`;
      report += `   Context: <i>"${w.context}"</i>\n\n`;
    });

    report += `\n📝 Total words found: ${words.length}`;
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
