import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { WordReviewService } from './word-review.service';
import { WORD_REVIEW_TIME_ZONE } from './word-review-schedule';

const WORD_REVIEW_CRON = '* * * * *';

@Injectable()
export class WordReviewSchedulerService {
  private readonly logger = new Logger(WordReviewSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wordReview: WordReviewService,
  ) {}

  @Cron(WORD_REVIEW_CRON, { timeZone: WORD_REVIEW_TIME_ZONE })
  async runScheduled() {
    const isDev = this.config.get('isDev');
    const enableInDev = this.config.get('wordReviewEnableInDev');
    if (isDev && !enableInDev) {
      return;
    }

    try {
      await this.wordReview.sendReviewBatch({ scheduled: true });
    } catch (err) {
      this.logger.error('Scheduled word review failed', err);
    }
  }
}
