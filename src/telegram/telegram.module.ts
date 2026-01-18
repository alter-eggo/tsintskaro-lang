import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { OpenaiModule } from '../openai/openai.module';

@Module({
  imports: [OpenaiModule],
  providers: [TelegramService, TelegramUpdate],
})
export class TelegramModule {}
