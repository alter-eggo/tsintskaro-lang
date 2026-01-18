import { Module } from '@nestjs/common';
import { OpenaiService } from './openai.service';
import { DictionaryModule } from '../dictionary/dictionary.module';

@Module({
  imports: [DictionaryModule],
  providers: [OpenaiService],
  exports: [OpenaiService],
})
export class OpenaiModule {}
