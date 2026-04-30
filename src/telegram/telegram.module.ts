import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { OpenaiModule } from '../openai/openai.module';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { PollModule } from '../poll/poll.module';
import { CollectedMessage } from './entities/collected-message.entity';
import { SummaryConfig } from './entities/summary-config.entity';
import { SummaryReport } from './entities/summary-report.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CollectedMessage, SummaryConfig, SummaryReport]),
    OpenaiModule,
    DictionaryModule,
    PollModule,
  ],
  providers: [TelegramService, TelegramUpdate],
})
export class TelegramModule {}
