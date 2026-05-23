import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { FactDayConfigService } from './fact-day-config.service';
import {
  TSINTSKARO_HISTORY_QUIZZES,
  TsintskaroHistoryQuiz,
} from './tsintskaro-history-quizzes';

export const FACT_DAY_CRON = '0 11 * * *';
export const FACT_DAY_TZ = 'Asia/Tbilisi';

type FactDaySendResult = {
  sent: boolean;
  quizNumber?: number;
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
        'Skipping history quiz — target chat not configured (run /startfactday)',
      );
      return { sent: false, reason: 'not_configured' };
    }

    if (target.enabled === false) {
      this.logger.log(
        `Skipping history quiz — disabled for chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: false, reason: 'disabled' };
    }

    const today = this.getDateInTimeZone(new Date(), FACT_DAY_TZ);
    if (!ignoreDailyGuard && target.lastSentDate === today) {
      this.logger.log(
        `Skipping history quiz — already sent today (${today}) to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: false, reason: 'already_sent' };
    }

    const quizIndex = this.normalizeFactIndex(target.nextFactIndex);
    const sourceQuiz = TSINTSKARO_HISTORY_QUIZZES[quizIndex];
    const quiz = this.prepareQuiz(sourceQuiz);
    const quizNumber = quizIndex + 1;

    try {
      await this.bot.telegram.sendQuiz(
        target.chatId,
        quiz.question,
        quiz.options,
        {
          correct_option_id: quiz.correctIndex,
          explanation: quiz.explanation,
          is_anonymous: false,
          message_thread_id: target.threadId ?? undefined,
        },
      );
      await this.factDayConfig.markSent(
        target.id,
        quizIndex,
        TSINTSKARO_HISTORY_QUIZZES.length,
        today,
      );
      this.logger.log(
        `Sent history quiz #${quizNumber}: chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
      );
      return { sent: true, quizNumber };
    } catch (err) {
      this.logger.error(
        `Failed to send history quiz to chat=${target.chatId}, thread=${target.threadId ?? 'none'}`,
        err,
      );
      return { sent: false, reason: 'send_failed' };
    }
  }

  getFactsCount(): number {
    return TSINTSKARO_HISTORY_QUIZZES.length;
  }

  private normalizeFactIndex(index: number): number {
    return (
      ((index % TSINTSKARO_HISTORY_QUIZZES.length) +
        TSINTSKARO_HISTORY_QUIZZES.length) %
      TSINTSKARO_HISTORY_QUIZZES.length
    );
  }

  private prepareQuiz(quiz: TsintskaroHistoryQuiz): TsintskaroHistoryQuiz {
    const correctOption = quiz.options[quiz.correctIndex];
    const options = this.shuffle(quiz.options);
    return {
      ...quiz,
      options,
      correctIndex: options.indexOf(correctOption),
      explanation: this.truncateExplanation(quiz.explanation),
    };
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

  private truncateExplanation(explanation: string): string {
    if (explanation.length <= 200) return explanation;
    return explanation.slice(0, 199) + '…';
  }

  private shuffle<T>(arr: readonly T[]): T[] {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
