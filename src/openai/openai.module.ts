import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OpenaiService } from './openai.service';
import { OpenaiUsageReportScheduler } from './openai-usage-report.scheduler';
import { OpenaiUsageService } from './openai-usage.service';
import { OpenaiUsageLog } from './entities/openai-usage-log.entity';
import { OpenaiUsageReportConfig } from './entities/openai-usage-report-config.entity';
import { DictionaryModule } from '../dictionary/dictionary.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OpenaiUsageLog, OpenaiUsageReportConfig]),
    DictionaryModule,
  ],
  providers: [OpenaiService, OpenaiUsageService, OpenaiUsageReportScheduler],
  exports: [OpenaiService, OpenaiUsageService],
})
export class OpenaiModule {}
