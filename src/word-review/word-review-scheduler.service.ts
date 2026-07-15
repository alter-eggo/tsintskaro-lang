import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { WordReviewService } from './word-review.service';

const WORD_REVIEW_CRON = '0 11 * * *';
const WORD_REVIEW_TZ = 'Asia/Tbilisi';

@Injectable()
export class WordReviewSchedulerService {
  private readonly logger = new Logger(WordReviewSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly wordReview: WordReviewService,
  ) {}

  @Cron(WORD_REVIEW_CRON, { timeZone: WORD_REVIEW_TZ })
  async runScheduled() {
    const isDev = this.config.get('isDev');
    const enableInDev = this.config.get('wordReviewEnableInDev');
    if (isDev && !enableInDev) {
      this.logger.log(
        'Skipping word review — dev environment (set WORD_REVIEW_ENABLE_IN_DEV=true to enable)',
      );
      return;
    }

    try {
      await this.wordReview.sendReviewBatch();
    } catch (err) {
      this.logger.error('Scheduled word review failed', err);
    }
  }
}
