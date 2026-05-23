import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { FactDayConfigService } from './fact-day-config.service';
import { TSINTSKARO_HISTORY_FACTS } from './tsintskaro-history-facts';

export const FACT_DAY_CRON = '0 11 * * *';
export const FACT_DAY_TZ = 'Asia/Tbilisi';

type FactDaySendResult = {
  sent: boolean;
  factNumber?: number;
  reason?: 'not_configured' | 'disabled' | 'already_sent' | 'send_failed';
};

@Injectable()
export class FactDaySchedulerService {
  private readonly logger = new Logger(FactDaySchedulerService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
    private readonly factDayConfig: FactDayConfigService,
  ) {}

  @Cron(FACT_DAY_CRON, { timeZone: FACT_DAY_TZ })
  async runScheduled() {
    const isDev = this.config.get('isDev');
    const enableInDev = this.config.get('factDayEnableInDev');
    if (isDev && !enableInDev) {
      this.logger.log(
        'Skipping fact day — dev environment (set FACT_DAY_ENABLE_IN_DEV=true to enable)',
      );
      return;
    }

    await this.sendNext();
  }

  async sendNext(ignoreDailyGuard = false): Promise<FactDaySendResult> {
    const target = await this.factDayConfig.get();
    if (!target) {
      this.logger.log(
        'Skipping fact day — target chat not configured (run /startfactday)',
      );
      return { sent: false, reason: 'not_configured' };
    }

    if (target.enabled === false) {
      this.logger.log(
        `Skipping fact day — disabled for chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: false, reason: 'disabled' };
    }

    const today = this.getDateInTimeZone(new Date(), FACT_DAY_TZ);
    if (!ignoreDailyGuard && target.lastSentDate === today) {
      this.logger.log(
        `Skipping fact day — already sent today (${today}) to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: false, reason: 'already_sent' };
    }

    const factIndex = this.normalizeFactIndex(target.nextFactIndex);
    const fact = TSINTSKARO_HISTORY_FACTS[factIndex];
    const factNumber = factIndex + 1;

    try {
      await this.bot.telegram.sendMessage(
        target.chatId,
        this.formatFact(fact, factNumber),
        {
          parse_mode: 'HTML',
          message_thread_id: target.threadId ?? undefined,
        },
      );
      await this.factDayConfig.markSent(
        target.id,
        factIndex,
        TSINTSKARO_HISTORY_FACTS.length,
        today,
      );
      this.logger.log(
        `Sent fact day #${factNumber}: chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: true, factNumber };
    } catch (err) {
      this.logger.error(
        `Failed to send fact day to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
        err,
      );
      return { sent: false, reason: 'send_failed' };
    }
  }

  getFactsCount(): number {
    return TSINTSKARO_HISTORY_FACTS.length;
  }

  private normalizeFactIndex(index: number): number {
    return (
      ((index % TSINTSKARO_HISTORY_FACTS.length) +
        TSINTSKARO_HISTORY_FACTS.length) %
      TSINTSKARO_HISTORY_FACTS.length
    );
  }

  private formatFact(fact: string, factNumber: number): string {
    return [
      '📜 <b>Факт дня из истории Цинцкаро</b>',
      '',
      `<b>Факт ${factNumber}/${TSINTSKARO_HISTORY_FACTS.length}.</b> ${this.escapeHtml(fact)}`,
    ].join('\n');
  }

  private getDateInTimeZone(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const part = (type: string) =>
      parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
