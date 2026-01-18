import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface ExtractedWord {
  word: string;
  possibleTranslation: string | null;
  context: string;
}

@Injectable()
export class OpenaiService {
  private openai: OpenAI;

  constructor(private config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get('openaiKey'),
    });
  }

  async analyzeMessages(messages: string[]): Promise<ExtractedWord[]> {
    const combinedText = messages.join('\n---\n');

    const prompt = `You are a linguistic analyst. Below are messages from a Telegram chat of people from Tsintskaro village (Georgia). They speak Russian but mix in words from their native language - an old Azerbaijani dialect written in Cyrillic script.

Your task:
1. Identify words that are NOT standard Russian - these are likely from their native Tsintskaro dialect
2. For each word found, try to guess a translation or meaning based on context (if impossible, say null)
3. Include a short context snippet showing how the word was used

Messages:
${combinedText}

Respond in JSON format only:
{
  "words": [
    {
      "word": "the non-Russian word",
      "possibleTranslation": "translation or null",
      "context": "short phrase where it appeared"
    }
  ]
}

If no non-Russian words found, return {"words": []}`;

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    const parsed = JSON.parse(content);

    return parsed.words || [];
  }
}
