import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  OpenaiUsageService,
  OPENAI_USAGE_REPORT_TIME_ZONE,
} from './openai-usage.service';

const OPENAI_USAGE_REPORT_CRON = '0 9 * * *';
const TELEGRAM_MESSAGE_LIMIT = 3900;

@Injectable()
export class OpenaiUsageReportScheduler {
  private readonly logger = new Logger(OpenaiUsageReportScheduler.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
    private readonly usageService: OpenaiUsageService,
  ) {}

  @Cron(OPENAI_USAGE_REPORT_CRON, { timeZone: OPENAI_USAGE_REPORT_TIME_ZONE })
  async sendDailyReport(): Promise<void> {
    const isDev = this.config.get('isDev');
    const enableInDev = this.config.get('openaiUsageReportEnableInDev');
    if (isDev && !enableInDev) {
      this.logger.log(
        'Skipping OpenAI usage report — dev environment (set OPENAI_USAGE_REPORT_ENABLE_IN_DEV=true to enable)',
      );
      return;
    }

    const target = await this.resolveTarget();
    if (!target) {
      this.logger.warn(
        'Skipping OpenAI usage report — target is not configured (run /settokenreport or set OPENAI_USAGE_REPORT_CHAT_ID)',
      );
      return;
    }

    const range = this.usageService.getCalendarDayRange(
      new Date(),
      OPENAI_USAGE_REPORT_TIME_ZONE,
      -1,
    );
    const report = await this.usageService.buildReport(
      range.start,
      range.end,
      OPENAI_USAGE_REPORT_TIME_ZONE,
      `Отчёт по OpenAI токенам за ${range.label}`,
    );

    try {
      for (const chunk of this.chunkString(report, TELEGRAM_MESSAGE_LIMIT)) {
        await this.bot.telegram.sendMessage(target.chatId, chunk, {
          message_thread_id: target.threadId ?? undefined,
        });
      }
      this.logger.log(
        `Sent OpenAI usage report to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send OpenAI usage report to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
        err,
      );
    }
  }

  private async resolveTarget(): Promise<{
    chatId: number;
    threadId: number | null;
  } | null> {
    const savedTarget = await this.usageService.getReportTarget();
    if (savedTarget) {
      return {
        chatId: savedTarget.chatId,
        threadId: savedTarget.threadId,
      };
    }

    const chatId = this.config.get<number | null>('openaiUsageReportChatId');
    if (!chatId) return null;

    return {
      chatId,
      threadId: this.config.get<number | null>('openaiUsageReportThreadId'),
    };
  }

  private chunkString(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt < maxLength * 0.6) splitAt = maxLength;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }
}
