import { Module } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { DictionarySyncService } from './dictionary-sync.service';

@Module({
  providers: [DictionaryService, DictionarySyncService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
