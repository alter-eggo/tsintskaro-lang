import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { PollConfigService } from './poll-config.service';
import { PollGeneratorService } from './poll-generator.service';
import { GeneratedQuiz } from './poll-generator.service';
import { PollDirection } from './entities/poll-history.entity';

const POLL_CRON = '0 8,10,12,14,16,18,20 * * *';
const POLL_TZ = 'Europe/Moscow';
const DELAY_BETWEEN_QUIZZES_MS = 30_000;

@Injectable()
export class PollSchedulerService {
  private readonly logger = new Logger(PollSchedulerService.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly config: ConfigService,
    private readonly pollConfig: PollConfigService,
    private readonly generator: PollGeneratorService,
  ) {}

  @Cron(POLL_CRON, { timeZone: POLL_TZ })
  async runScheduled() {
    const isDev = this.config.get('isDev');
    const enableInDev = this.config.get('pollEnableInDev');
    if (isDev && !enableInDev) {
      this.logger.log(
        'Skipping scheduled polls — dev environment (set POLL_ENABLE_IN_DEV=true to enable)',
      );
      return;
    }
    try {
      const target = await this.pollConfig.get();
      if (!target) {
        this.logger.log(
          'Skipping scheduled polls — target chat not configured (run /setpollchat)',
        );
        return;
      }
      await this.sendOne('ts_to_ru', target.chatId, target.threadId);
    } catch (err) {
      this.logger.error('Scheduled poll run failed', err);
    }
  }

  async sendBoth(): Promise<{ tsToRu: boolean; ruToTs: boolean }> {
    const target = await this.pollConfig.get();
    if (!target) {
      this.logger.log(
        'Skipping scheduled polls — target chat not configured (run /setpollchat)',
      );
      return { tsToRu: false, ruToTs: false };
    }

    const tsToRu = await this.sendOne('ts_to_ru', target.chatId, target.threadId);
    await this.delay(DELAY_BETWEEN_QUIZZES_MS);
    const ruToTs = await this.sendOne('ru_to_ts', target.chatId, target.threadId);

    return { tsToRu, ruToTs };
  }

  async sendOne(
    direction: PollDirection,
    chatId: number,
    threadId: number | null,
  ): Promise<boolean> {
    let quiz: GeneratedQuiz | null;
    try {
      quiz = await this.generator.generate(direction);
    } catch (err) {
      this.logger.error(`Failed to generate ${direction} quiz`, err);
      return false;
    }
    if (!quiz) {
      this.logger.warn(`Quiz generator returned null for ${direction}`);
      return false;
    }

    try {
      const sent = await this.bot.telegram.sendQuiz(
        chatId,
        quiz.question,
        quiz.options,
        {
          correct_option_id: quiz.correctIndex,
          is_anonymous: true,
          message_thread_id: threadId ?? undefined,
        },
      );
      const pollId =
        sent && 'poll' in sent && sent.poll ? sent.poll.id : null;
      await this.generator.recordSent(quiz, chatId, threadId, pollId);
      this.logger.log(
        `Sent ${direction} quiz: word="${quiz.word}", chat=${chatId}, thread=${threadId ?? 'none'}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send ${direction} quiz to chat=${chatId}, thread=${threadId ?? 'none'}`,
        err,
      );
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
