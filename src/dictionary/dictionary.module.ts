import { Module } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';

@Module({
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
