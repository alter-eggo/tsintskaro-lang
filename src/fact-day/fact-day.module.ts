import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FactDayConfig } from './entities/fact-day-config.entity';
import { FactDayConfigService } from './fact-day-config.service';
import { FactDaySchedulerService } from './fact-day-scheduler.service';

@Module({
  imports: [TypeOrmModule.forFeature([FactDayConfig])],
  providers: [FactDayConfigService, FactDaySchedulerService],
  exports: [FactDayConfigService, FactDaySchedulerService],
})
export class FactDayModule {}
