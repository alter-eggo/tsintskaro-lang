import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryModule } from '../dictionary/dictionary.module';
import { PollConfig } from './entities/poll-config.entity';
import { PollHistory } from './entities/poll-history.entity';
import { PollConfigService } from './poll-config.service';
import { PollGeneratorService } from './poll-generator.service';
import { PollSchedulerService } from './poll-scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PollConfig, PollHistory]),
    DictionaryModule,
  ],
  providers: [PollConfigService, PollGeneratorService, PollSchedulerService],
  exports: [PollConfigService, PollSchedulerService],
})
export class PollModule {}
