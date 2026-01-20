import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './telegram.update';
import { OpenaiModule } from '../openai/openai.module';
import { DictionaryModule } from '../dictionary/dictionary.module';

@Module({
  imports: [OpenaiModule, DictionaryModule],
  providers: [TelegramService, TelegramUpdate],
})
export class TelegramModule {}
