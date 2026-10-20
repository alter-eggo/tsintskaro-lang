import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { OpenaiModule } from '../openai/openai.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { PollModule } from '../poll/poll.module';
import { FactDayModule } from '../fact-day/fact-day.module';
import { WordReviewModule } from '../word-review/word-review.module';
import { CollectedMessage } from './entities/collected-message.entity';
import { SummaryConfig } from './entities/summary-config.entity';
import { SummaryReport } from './entities/summary-report.entity';
import { BotMemory } from './entities/bot-memory.entity';
import { DictionaryRequest } from './entities/dictionary-request.entity';
import { BotEvent } from './entities/bot-event.entity';
import { DictionaryRequestService } from './dictionary-request.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectedMessage,
      SummaryConfig,
      SummaryReport,
      BotMemory,
      DictionaryRequest,
      BotEvent,
    ]),
    OpenaiModule,
    DictionaryModule,
    PollModule,
    FactDayModule,
    WordReviewModule,
  ],
  providers: [TelegramService, TelegramUpdate, DictionaryRequestService],
})
export class TelegramModule {}
