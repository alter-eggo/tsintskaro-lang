import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Word } from '../dictionary/entities/word.entity';
import { WordReviewBatch } from './entities/word-review-batch.entity';
import { WordReviewConfig } from './entities/word-review-config.entity';
import { WordReviewCorrectionRequest } from './entities/word-review-correction-request.entity';
import { WordReviewHistory } from './entities/word-review-history.entity';
import { WordReviewItem } from './entities/word-review-item.entity';
import { WordReviewDecision } from './entities/word-review-decision.entity';
import { WordReviewVote } from './entities/word-review-vote.entity';
import { WordReviewSchedulerService } from './word-review-scheduler.service';
import { WordReviewService } from './word-review.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Word,
      WordReviewConfig,
      WordReviewHistory,
      WordReviewBatch,
      WordReviewItem,
      WordReviewDecision,
      WordReviewVote,
      WordReviewCorrectionRequest,
    ]),
  ],
  providers: [WordReviewService, WordReviewSchedulerService],
  exports: [WordReviewService],
})
export class WordReviewModule {}
