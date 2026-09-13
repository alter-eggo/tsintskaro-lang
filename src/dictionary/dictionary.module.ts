import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryService } from './dictionary.service';
import { Word } from './entities/word.entity';
import { WordTranslationHistory } from './entities/word-translation-history.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Word, WordTranslationHistory])],
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
