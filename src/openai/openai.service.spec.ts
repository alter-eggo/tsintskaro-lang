import { OpenaiService } from './openai.service';

describe('OpenaiService token-efficient requests', () => {
  const makeService = () => {
    const configValues: Record<string, unknown> = {
      openaiKey: 'test-key',
      openaiBotModel: 'gpt-5.4-mini',
      openaiExtractionModel: 'gpt-5.4-nano',
      openaiReportModel: 'gpt-5.4-mini',
      openaiBotMaxCompletionTokens: 800,
      openaiExtractionMaxCompletionTokens: 3000,
      openaiReportMaxCompletionTokens: 4000,
    };
    const dictionaryService = {
      findRelevantForPrompt: jest.fn(async () => [
        { word: 'ширин', translation: 'сладкий', partOfSpeech: 'прил.' },
      ]),
      formatEntriesForPrompt: jest.fn(() => 'ширин = сладкий'),
    };
    const usageService = { record: jest.fn(async () => undefined) };
    const service = new OpenaiService(
      { get: jest.fn((key: string) => configValues[key]) } as any,
      dictionaryService as any,
      usageService as any,
    );
    const create = jest.fn(async (params: unknown) => {
      void params;
      return {
        model: 'gpt-5.4-mini-2026-03-17',
        choices: [
          {
            message: {
              content: JSON.stringify({
                discussionSummary: 'Обсудили значение слова [m1].',
                words: [
                  {
                    word: 'ширин',
                    possibleTranslation: 'сладкий',
                    context: 'Ширин чай',
                    partOfSpeech: 'прил.',
                    username: 'alice',
                  },
                  {
                    word: 'ширин',
                    possibleTranslation: 'милый',
                    context: 'Ширин человек',
                    partOfSpeech: 'прил.',
                    username: 'bob',
                  },
                ],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 900,
          completion_tokens: 150,
          total_tokens: 1050,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      };
    });
    (service as any).openai = {
      chat: { completions: { create } },
    };
    return { service, create, dictionaryService, usageService };
  };

  it('creates one structured report with only relevant dictionary entries', async () => {
    const { service, create, dictionaryService, usageService } = makeService();
    const messages = [
      { text: 'Ширин значит сладкий', username: 'alice', ref: 'm1' },
      { text: 'А для меня это милый', username: 'bob', ref: 'm2' },
    ];

    const result = await service.analyzeDiscussion(messages);

    expect(create).toHaveBeenCalledTimes(1);
    expect(dictionaryService.findRelevantForPrompt).toHaveBeenCalledWith(
      messages.map((message) => message.text),
      100,
    );
    const request = create.mock.calls[0][0] as any;
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.reasoning_effort).toBe('none');
    expect(request.max_completion_tokens).toBe(4000);
    expect(request.prompt_cache_key).toBe('tsintskaro:discussion_report:v2');
    expect(request.response_format.type).toBe('json_schema');
    expect(request.messages[1].content).toContain('ширин = сладкий');

    expect(result.words).toHaveLength(2);
    expect(result.discussionResult.disputedWords).toEqual([
      expect.objectContaining({
        word: 'ширин',
        translationVariants: [
          { username: 'alice', translation: 'сладкий' },
          { username: 'bob', translation: 'милый' },
        ],
      }),
    ]);
    expect(usageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'discussion_report',
        metadata: expect.objectContaining({
          messagesCount: 2,
          dictionaryEntries: 1,
          reasoningEffort: 'none',
          maxCompletionTokens: 4000,
        }),
      }),
    );
  });
});
