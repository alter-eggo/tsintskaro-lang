import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegrafModule } from 'nestjs-telegraf';
import { TelegramModule } from './telegram/telegram.module';
import { OpenaiModule } from './openai/openai.module';
import { PollModule } from './poll/poll.module';
import { PollConfig } from './poll/entities/poll-config.entity';
import { PollHistory } from './poll/entities/poll-history.entity';
import { CollectedMessage } from './telegram/entities/collected-message.entity';
import { SummaryConfig } from './telegram/entities/summary-config.entity';
import { SummaryReport } from './telegram/entities/summary-report.entity';
import configuration from './config/configuration';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('databaseUrl'),
        entities: [
          PollConfig,
          PollHistory,
          CollectedMessage,
          SummaryConfig,
          SummaryReport,
        ],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        token: config.get('telegramToken'),
      }),
      inject: [ConfigService],
    }),
    TelegramModule,
    OpenaiModule,
    PollModule,
  ],
})
export class AppModule {}
