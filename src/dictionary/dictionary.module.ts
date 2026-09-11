import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryService } from './dictionary.service';
import { Word } from './entities/word.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Word])],
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
