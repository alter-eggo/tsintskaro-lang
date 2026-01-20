import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { DictionaryService } from '../dictionary/dictionary.service';

interface ExtractedWord {
  word: string;
  possibleTranslation: string | null;
  context: string;
}

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor(
    private config: ConfigService,
    private dictionaryService: DictionaryService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get('openaiKey'),
    });
  }

  async analyzeMessages(messages: string[]): Promise<ExtractedWord[]> {
    const combinedText = messages.join('\n---\n');
    const dictionary = this.dictionaryService.getFormattedForPrompt();

    const dictionarySection = dictionary
      ? `\nИзвестные слова из словаря (используй эти переводы):\n${dictionary}\n`
      : '';

    const prompt = `Ты лингвистический аналитик. Ниже сообщения из Telegram-чата жителей села Цинцкаро (Грузия). 
    Они говорят по-русски, но вставляют слова из родного языка — смеси из старого азербайджанского диалекта и восточно-анатолийского диалекта турецкого языка, записанных кириллицей.
${dictionarySection}
Твоя задача:
1. Найти слова, которые НЕ являются стандартным русским языком — это слова из цинцкарского диалекта
2. Если слово есть в словаре выше — используй перевод оттуда
3. Если слова нет в словаре — попробуй угадать перевод по контексту (если невозможно — напиши null)
4. Добавь короткий контекст, где слово было использовано

Сообщения:
${combinedText}

Отвечай ТОЛЬКО в формате JSON:
{
  "words": [
    {
      "word": "нерусское слово",
      "possibleTranslation": "перевод на русский или null",
      "context": "короткая фраза где появилось"
    }
  ]
}

Если нерусских слов не найдено, верни {"words": []}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    return parsed.words || [];
  }
}
