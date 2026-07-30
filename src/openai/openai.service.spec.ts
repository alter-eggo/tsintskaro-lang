import { OpenaiService } from './openai.service';

describe('OpenaiService requests', () => {
  const completion = (content: string) => ({
    model: 'gpt-5.5',
    choices: [{ message: { content, refusal: null } }],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 150,
      total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });

  const toolCompletion = (
    calls: Array<{
      id: string;
      query: string;
      direction: 'both' | 'tsintskaro_to_russian' | 'russian_to_tsintskaro';
    }>,
  ) => ({
    model: 'gpt-5.5',
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: calls.map(({ id, query, direction }) => ({
            id,
            type: 'function',
            function: {
              name: 'search_dictionary',
              arguments: JSON.stringify({ query, direction }),
            },
          })),
        },
      },
    ],
    usage: {
      prompt_tokens: 900,
      completion_tokens: 50,
      total_tokens: 950,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  });

  const makeService = () => {
    const configValues: Record<string, unknown> = {
      openaiKey: 'test-key',
      openaiBotModel: 'gpt-5.5',
      openaiExtractionModel: 'gpt-5.5',
      openaiReportModel: 'gpt-5.5',
      openaiBotMaxCompletionTokens: 800,
      openaiExtractionMaxCompletionTokens: 3000,
      openaiReportMaxCompletionTokens: 4000,
    };
    const dictionaryService = {
      findRelevantForPrompt: jest.fn(async () => [
        { word: 'ширин', translation: 'сладкий', partOfSpeech: 'прил.' },
      ]),
      formatEntriesForPrompt: jest.fn(() => 'ширин = сладкий'),
      findWord: jest.fn(async () => undefined),
      findByTranslation: jest.fn(async () => []),
    };
    const usageService = { record: jest.fn(async () => undefined) };
    const service = new OpenaiService(
      { get: jest.fn((key: string) => configValues[key]) } as any,
      dictionaryService as any,
      usageService as any,
    );
    const create = jest.fn(async (params: unknown) => {
      void params;
      return completion(
        JSON.stringify({
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
      );
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
    expect(request.model).toBe('gpt-5.5');
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

  it('uses GPT-5.5 to preserve complete dictionary phrases', async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(
      completion(
        JSON.stringify({
          entries: [
            {
              word: 'аралыхги бозмах',
              translation: 'испортить отношения',
              partOfSpeech: null,
            },
            {
              word: 'суда бохгулмах',
              translation: 'утонуть в воде',
              partOfSpeech: null,
            },
          ],
        }),
      ),
    );

    const result = await service.normalizeDictionaryEntries(
      'Баласи, добавь:\nАралыхги бозмах-испортить отношения,\nСуда бохгулмах- утонуть в воде',
    );

    expect(result).toEqual([
      {
        word: 'аралыхги бозмах',
        translation: 'испортить отношения',
        partOfSpeech: null,
      },
      {
        word: 'суда бохгулмах',
        translation: 'утонуть в воде',
        partOfSpeech: null,
      },
    ]);
    const request = create.mock.calls[0][0] as any;
    expect(request.model).toBe('gpt-5.5');
    expect(request.reasoning_effort).toBe('none');
    expect(request.response_format.json_schema.name).toBe('dictionary_entries');
  });

  it('uses a simple reply schema for ordinary conversation', async () => {
    const { service, create, usageService } = makeService();
    create.mockResolvedValueOnce(
      completion(
        JSON.stringify({
          message: 'Понял, автоматические лайки и реакции отключены.',
        }),
      ),
    );

    const result = await service.processBotMention(
      'Баласи, не надо ставить лайки.',
    );

    expect(result).toEqual({
      action: 'reply',
      message: 'Понял, автоматические лайки и реакции отключены.',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0] as any;
    expect(request.response_format.json_schema.name).toBe('bot_reply');
    expect(request.prompt_cache_key).toBe('tsintskaro:bot_reply:v4');
    expect(request.tool_choice).toBe('auto');
    expect(request.tools[0].function).toEqual(
      expect.objectContaining({
        name: 'search_dictionary',
        strict: true,
      }),
    );
    expect(request.tools[0].function.parameters).toEqual(
      expect.objectContaining({
        required: ['query', 'direction'],
        additionalProperties: false,
      }),
    );
    expect(request.messages[0].content).not.toContain('add_words');
    expect(usageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ responseMode: 'conversation' }),
      }),
    );
  });

  it('keeps an ordinary question out of the action router', async () => {
    const { service, create } = makeService();
    create.mockResolvedValueOnce(
      completion(
        JSON.stringify({
          message:
            'Смочи пятно холодной водой и используй подходящее средство для ткани.',
        }),
      ),
    );

    const result = await service.processBotMention(
      'Баласи, как удалить пятно с рубашки?',
    );

    expect(result).toEqual({
      action: 'reply',
      message:
        'Смочи пятно холодной водой и используй подходящее средство для ткани.',
    });
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0] as any;
    expect(request.response_format.json_schema.name).toBe('bot_reply');
    expect(request.messages[0].content).toContain(
      'Отвечай на обычные вопросы на общие темы',
    );
  });

  it('lets the model search the real dictionary for free-form wording', async () => {
    const { service, create, dictionaryService, usageService } = makeService();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'чâсич',
        translation: 'порез',
        partOfSpeech: null,
      },
    ]);
    create
      .mockResolvedValueOnce(
        toolCompletion([
          {
            id: 'call_dictionary_1',
            query: 'порез',
            direction: 'russian_to_tsintskaro',
          },
        ]),
      )
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            message: 'В словаре «порез» — чâсич.',
          }),
        ),
      );

    const result = await service.processBotMention(
      'Баласи, напомни, как наши называют небольшой порез?',
    );

    expect(result).toEqual({
      action: 'reply',
      message: 'В словаре «порез» — чâсич.',
    });
    expect(dictionaryService.findWord).not.toHaveBeenCalled();
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('порез');
    expect(create).toHaveBeenCalledTimes(2);

    const finalRequest = create.mock.calls[1][0] as any;
    expect(finalRequest.tool_choice).toBe('none');
    expect(finalRequest.messages.at(-2)).toEqual(
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [
          expect.objectContaining({
            id: 'call_dictionary_1',
            function: expect.objectContaining({
              name: 'search_dictionary',
            }),
          }),
        ],
      }),
    );
    const toolMessage = finalRequest.messages.at(-1);
    expect(toolMessage).toEqual(
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_dictionary_1',
      }),
    );
    expect(JSON.parse(toolMessage.content)).toEqual({
      searched: true,
      query: 'порез',
      direction: 'russian_to_tsintskaro',
      matchCount: 1,
      matches: [
        {
          word: 'чâсич',
          translation: 'порез',
          partOfSpeech: null,
        },
      ],
    });
    expect(usageService.record).toHaveBeenCalledTimes(2);
    expect(usageService.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          dictionaryToolStage: 'answer',
          dictionaryToolCalls: 1,
        }),
      }),
    );
  });

  it('executes every dictionary lookup requested in one model turn', async () => {
    const { service, create, dictionaryService } = makeService();
    dictionaryService.findByTranslation
      .mockResolvedValueOnce([
        { word: 'чâсич', translation: 'порез', partOfSpeech: null },
      ])
      .mockResolvedValueOnce([
        { word: 'дам', translation: 'сарай', partOfSpeech: null },
      ]);
    create
      .mockResolvedValueOnce(
        toolCompletion([
          {
            id: 'call_dictionary_cut',
            query: 'порез',
            direction: 'russian_to_tsintskaro',
          },
          {
            id: 'call_dictionary_shed',
            query: 'сарай',
            direction: 'russian_to_tsintskaro',
          },
        ]),
      )
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            message: '«Порез» — чâсич, а «сарай» — дам.',
          }),
        ),
      );

    const result = await service.processBotMention(
      'Баласи, а как у нас будут порез и сарай?',
    );

    expect(result).toEqual({
      action: 'reply',
      message: '«Порез» — чâсич, а «сарай» — дам.',
    });
    expect(dictionaryService.findByTranslation).toHaveBeenNthCalledWith(
      1,
      'порез',
    );
    expect(dictionaryService.findByTranslation).toHaveBeenNthCalledWith(
      2,
      'сарай',
    );
    const finalRequest = create.mock.calls[1][0] as any;
    expect(
      finalRequest.messages.filter(
        (message: { role: string }) => message.role === 'tool',
      ),
    ).toHaveLength(2);
  });

  it('returns an explicit empty tool result instead of inventing a match', async () => {
    const { service, create, dictionaryService } = makeService();
    create
      .mockResolvedValueOnce(
        toolCompletion([
          {
            id: 'call_dictionary_missing',
            query: 'несуществующее слово',
            direction: 'both',
          },
        ]),
      )
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            message:
              'Точного совпадения для «несуществующее слово» в словаре нет.',
          }),
        ),
      );

    const result = await service.processBotMention(
      'Баласи, у нас случайно нет названия для несуществующего слова?',
    );

    expect(result).toEqual({
      action: 'reply',
      message: 'Точного совпадения для «несуществующее слово» в словаре нет.',
    });
    expect(dictionaryService.findWord).toHaveBeenCalledWith(
      'несуществующее слово',
    );
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith(
      'несуществующее слово',
    );
    const finalRequest = create.mock.calls[1][0] as any;
    const toolMessage = finalRequest.messages.at(-1);
    expect(JSON.parse(toolMessage.content)).toEqual({
      searched: true,
      query: 'несуществующее слово',
      direction: 'both',
      matchCount: 0,
      matches: [],
    });
  });

  it('forces the action agent for a dictionary correction fallback', async () => {
    const { service, create, usageService } = makeService();
    create.mockResolvedValueOnce(
      completion(
        JSON.stringify({
          action: 'update_words',
          entries: [
            {
              word: null,
              translation: null,
              partOfSpeech: null,
              oldWord: 'яначчынын дâ шââтӱ',
              newWord: 'яланчынын дâ шââтӱ',
            },
          ],
          words: [],
          text: null,
          message: null,
        }),
      ),
    );

    const result = await service.processBotMention(
      'Баласи, можешь исправить ошибку в словарной записи?',
      [],
      [],
      [
        {
          word: 'яначчынын дâ шââтӱ',
          translation: 'подтверждение правильности слов',
        },
      ],
      { forceAction: true },
    );

    expect(result).toEqual({
      action: 'update_words',
      entries: [
        {
          oldWord: 'яначчынын дâ шââтӱ',
          newWord: 'яланчынын дâ шââтӱ',
          translation: null,
          partOfSpeech: undefined,
        },
      ],
    });
    expect(create).toHaveBeenCalledTimes(1);
    const request = create.mock.calls[0][0] as any;
    expect(request.response_format.json_schema.name).toBe('bot_mention_action');
    expect(request.messages[0].content).toContain(
      'Локальный обработчик определил',
    );
    expect(usageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ forceAction: true }),
      }),
    );
  });

  it('repairs an action response that has no user-facing message', async () => {
    const { service, create } = makeService();
    create
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
            message: null,
          }),
        ),
      )
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            message: 'Конечно, помогу сделать текст живее.',
          }),
        ),
      );

    const result = await service.processBotMention(
      'Баласи, добавь немного юмора в объявление.',
    );

    expect(result).toEqual({
      action: 'reply',
      message: 'Конечно, помогу сделать текст живее.',
    });
    expect(create).toHaveBeenCalledTimes(2);
    const actionRequest = create.mock.calls[0][0] as any;
    const repairRequest = create.mock.calls[1][0] as any;
    expect(actionRequest.response_format.json_schema.name).toBe(
      'bot_mention_action',
    );
    expect(repairRequest.response_format.json_schema.name).toBe('bot_reply');
  });
});
