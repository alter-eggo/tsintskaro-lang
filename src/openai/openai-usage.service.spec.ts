import { OpenaiUsageService } from './openai-usage.service';

describe('OpenaiUsageService reports', () => {
  it('shows cached tokens, reasoning tokens, p95, and request metadata', async () => {
    const usageRepo = {
      find: jest.fn(async () => [
        {
          purpose: 'bot_mention',
          detail: 'Первый запрос',
          model: 'gpt-5.4-mini',
          promptTokens: 1000,
          completionTokens: 200,
          totalTokens: 1200,
          rawUsage: {
            prompt_tokens_details: { cached_tokens: 400 },
            completion_tokens_details: { reasoning_tokens: 50 },
          },
          metadata: {
            messagesCount: 20,
            dictionaryEntries: 3,
            inputTextLength: 4000,
            reasoningEffort: 'none',
            maxCompletionTokens: 800,
          },
          createdAt: new Date('2026-07-15T08:00:00.000Z'),
        },
        {
          purpose: 'discussion_report',
          detail: 'Второй запрос',
          model: 'gpt-5.4-mini',
          promptTokens: 2000,
          completionTokens: 200,
          totalTokens: 2200,
          rawUsage: {
            prompt_tokens_details: { cached_tokens: 800 },
            completion_tokens_details: { reasoning_tokens: 250 },
          },
          metadata: {},
          createdAt: new Date('2026-07-15T09:00:00.000Z'),
        },
      ]),
    };
    const service = new OpenaiUsageService(usageRepo as any, {} as any);

    const report = await service.buildReport(
      new Date('2026-07-14T20:00:00.000Z'),
      new Date('2026-07-15T20:00:00.000Z'),
    );

    expect(report).toMatch(/Из кэша: 1.200 \(40% входа\)/);
    expect(report).toMatch(/Reasoning: 300/);
    expect(report).toMatch(/p95 на запрос: 2.200 токенов/);
    expect(report).toContain('messages=20');
    expect(report).toContain('словарь=3');
    expect(report).toContain('reasoning=none');
    expect(report).toContain('лимит=800');
  });
});
