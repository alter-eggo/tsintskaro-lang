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

  const response = (content: string) => ({
    model: 'gpt-5.5',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: content, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 900,
      output_tokens: 150,
      total_tokens: 1050,
      input_tokens_details: { cached_tokens: 100 },
      output_tokens_details: { reasoning_tokens: 50 },
    },
  });

  const toolResponse = (
    calls: Array<{
      id: string;
      query: string;
      direction: 'both' | 'tsintskaro_to_russian' | 'russian_to_tsintskaro';
    }>,
  ) => ({
    ...response(''),
    output: [
      {
        type: 'reasoning',
        id: 'rs_test',
        summary: [],
        encrypted_content: 'opaque-state',
      },
      ...calls.map(({ id, query, direction }) => ({
        id: `fc_${id}`,
        call_id: id,
        type: 'function_call',
        name: 'search_dictionary',
        arguments: JSON.stringify({ query, direction }),
      })),
    ],
  });

  const makeService = () => {
    const configValues: Record<string, unknown> = {
      openaiKey: 'test-key',
      openaiBotModel: 'gpt-5.5',
      openaiExtractionModel: 'gpt-5.5',
      openaiReportModel: 'gpt-5.5',
      openaiBotMaxCompletionTokens: 8000,
      openaiExtractionMaxCompletionTokens: 12000,
      openaiReportMaxCompletionTokens: 16000,
    };
    const dictionaryService = {
      findRelevantForPrompt: jest.fn(async () => [
        { word: 'ширин', translation: 'сладкий', partOfSpeech: 'прил.' },
      ]),
      formatEntriesForPrompt: jest.fn(() => 'ширин = сладкий'),
      findWord: jest.fn(async () => undefined),
      findByTranslation: jest.fn(async () => []),
      getLeaderboard: jest.fn(async () => [
        { username: 'alice', wordsCount: 12 },
      ]),
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
    const respond = jest.fn(async (params: unknown): Promise<any> => {
      void params;
      throw new Error('Unexpected Responses API request');
    });
    (service as any).openai = {
      responses: { create: respond },
      chat: { completions: { create } },
    };
    return { service, create, respond, dictionaryService, usageService };
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
    expect(request.reasoning_effort).toBe('medium');
    expect(request.max_completion_tokens).toBe(16000);
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
          reasoningEffort: 'medium',
          maxCompletionTokens: 16000,
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
    expect(request.reasoning_effort).toBe('medium');
    expect(request.response_format.json_schema.name).toBe('dictionary_entries');
  });

  it('answers an ordinary question in one model request', async () => {
    const { service, create, respond, usageService } = makeService();
    respond.mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
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
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    const request = respond.mock.calls[0][0] as any;
    expect(request.text.format.name).toBe('bot_mention_action');
    expect(request.prompt_cache_key).toBe('tsintskaro:bot_mention:v7');
    expect(request.tool_choice).toBe('auto');
    expect(request.reasoning).toEqual({ effort: 'medium' });
    expect(request.max_output_tokens).toBe(8000);
    expect(request.store).toBe(false);
    expect(request.include).toContain('reasoning.encrypted_content');
    expect(request.tools[0]).toEqual(
      expect.objectContaining({
        name: 'search_dictionary',
        strict: true,
      }),
    );
    expect(request.tools[0].parameters).toEqual(
      expect.objectContaining({
        required: ['query', 'direction'],
        additionalProperties: false,
      }),
    );
    expect(request.input[0].content).toContain('add_words');
    expect(usageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: {
          prompt_tokens: 900,
          completion_tokens: 150,
          total_tokens: 1050,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens_details: { reasoning_tokens: 50 },
        },
        metadata: expect.objectContaining({
          responseMode: 'bot',
          api: 'responses',
        }),
      }),
    );
  });

  it('answers a deletion question without a dictionary mutation or an extra request', async () => {
    const { service, create, respond } = makeService();
    respond.mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
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
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    const request = respond.mock.calls[0][0] as any;
    expect(request.text.format.name).toBe('bot_mention_action');
    expect(request.input[0].content).toContain(
      'Отвечай на обычные вопросы на общие темы',
    );
  });

  it('lets the model search the real dictionary for free-form wording', async () => {
    const { service, create, respond, dictionaryService, usageService } =
      makeService();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'чâсич',
        translation: 'порез',
        partOfSpeech: null,
      },
    ]);
    respond
      .mockResolvedValueOnce(
        toolResponse([
          {
            id: 'call_dictionary_1',
            query: 'порез',
            direction: 'russian_to_tsintskaro',
          },
        ]),
      )
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
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
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(2);

    const finalRequest = respond.mock.calls[1][0] as any;
    expect(finalRequest.tool_choice).toBe('auto');
    expect(finalRequest.input.at(-3)).toEqual({
      type: 'reasoning',
      id: 'rs_test',
      summary: [],
      encrypted_content: 'opaque-state',
    });
    expect(finalRequest.input.at(-2)).toEqual(
      expect.objectContaining({
        type: 'function_call',
        call_id: 'call_dictionary_1',
        name: 'search_dictionary',
      }),
    );
    const toolMessage = finalRequest.input.at(-1);
    expect(toolMessage).toEqual(
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_dictionary_1',
      }),
    );
    expect(JSON.parse(toolMessage.output)).toEqual({
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
    const { service, respond, dictionaryService } = makeService();
    dictionaryService.findByTranslation
      .mockResolvedValueOnce([
        { word: 'чâсич', translation: 'порез', partOfSpeech: null },
      ])
      .mockResolvedValueOnce([
        { word: 'дам', translation: 'сарай', partOfSpeech: null },
      ]);
    respond
      .mockResolvedValueOnce(
        toolResponse([
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
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
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
    const finalRequest = respond.mock.calls[1][0] as any;
    expect(
      finalRequest.input.filter(
        (message: { type: string }) => message.type === 'function_call_output',
      ),
    ).toHaveLength(2);
  });

  it('returns an explicit empty tool result instead of inventing a match', async () => {
    const { service, respond, dictionaryService } = makeService();
    respond
      .mockResolvedValueOnce(
        toolResponse([
          {
            id: 'call_dictionary_missing',
            query: 'несуществующее слово',
            direction: 'both',
          },
        ]),
      )
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
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
    const finalRequest = respond.mock.calls[1][0] as any;
    const toolMessage = finalRequest.input.at(-1);
    expect(JSON.parse(toolMessage.output)).toEqual({
      searched: true,
      query: 'несуществующее слово',
      direction: 'both',
      matchCount: 0,
      matches: [],
    });
  });

  it('forces the action agent for a dictionary correction fallback', async () => {
    const { service, create, respond, usageService } = makeService();
    respond.mockResolvedValueOnce(
      response(
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
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    const request = respond.mock.calls[0][0] as any;
    expect(request.text.format.name).toBe('bot_mention_action');
    expect(request.input[0].content).toContain(
      'Локальный обработчик определил',
    );
    expect(usageService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ forceAction: true }),
      }),
    );
  });

  it.each([
    {
      question: 'Баласи, внеси ширин — сладкий',
      action: 'add_words',
      payload: {
        entries: [
          { word: 'Ширин', translation: 'сладкий', partOfSpeech: null },
        ],
      },
      expected: {
        action: 'add_words',
        entries: [
          { word: 'ширин', translation: 'сладкий', partOfSpeech: null },
        ],
      },
    },
    {
      question: 'Баласи, убери слово дом из словаря',
      action: 'delete_words',
      payload: { words: ['Дом'] },
      expected: { action: 'delete_words', words: ['дом'] },
    },
    {
      question: 'Баласи, сохрани в памяти: встреча в воскресенье',
      action: 'add_memory',
      payload: { text: 'Встреча в воскресенье.' },
      expected: { action: 'add_memory', text: 'Встреча в воскресенье.' },
    },
  ])(
    'returns $action in the first model response',
    async ({ question, action, payload, expected }) => {
      const { service, create, respond } = makeService();
      respond.mockResolvedValueOnce(
        response(
          JSON.stringify({
            action,
            entries: [],
            words: [],
            text: null,
            message: null,
            ...payload,
          }),
        ),
      );
      await expect(service.processBotMention(question)).resolves.toEqual(
        expected,
      );
      expect(respond).toHaveBeenCalledTimes(1);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('answers a writing request in the same call that chooses the action', async () => {
    const { service, create, respond } = makeService();
    respond.mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
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
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(1);
    const request = respond.mock.calls[0][0] as any;
    expect(request.text.format.name).toBe('bot_mention_action');
  });
  it('puts the reply target, speaker roles and saved language rules in the model request', async () => {
    const { service, respond } = makeService();
    respond.mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
          message: 'Âвлâр — дома.',
        }),
      ),
    );
    await service.processBotMention(
      'А во множественном числе?',
      [
        {
          username: 'bot',
          text: 'Âв — дом.',
          sentAt: new Date('2026-09-14T21:30:00Z'),
          isBot: true,
        },
      ],
      [
        {
          text: 'После â используется -лâр.',
          createdBy: 'admin',
          createdAt: new Date(),
        },
      ],
      [{ word: 'âв', translation: 'дом' }],
      {
        replyToMessage: {
          username: 'bot',
          text: 'Âв — дом.',
          sentAt: new Date(),
          isBot: true,
        },
      },
    );
    const request = respond.mock.calls[0][0] as any;
    expect(request.input[1].content).toContain(
      'СООБЩЕНИЕ, НА КОТОРОЕ ОТВЕЧАЕТ ПОЛЬЗОВАТЕЛЬ',
    );
    expect(request.input[1].content).toContain('Баласи (бот): Âв — дом.');
    expect(request.input[1].content).toContain('[15.09.2026, 00:30 МСК]');
    expect(request.input[0].content).toContain('Europe/Moscow');
    expect(request.input[1].content).toContain('После â используется -лâр.');
    expect(request.input[1].content).toContain('âв = дом');
  });
  it('retries dictionary search after an empty result and answers the original question', async () => {
    const { service, create, respond, dictionaryService } = makeService();
    dictionaryService.findByTranslation
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { word: 'чâсич', translation: 'порез', partOfSpeech: null },
      ]);
    respond
      .mockResolvedValueOnce(
        toolResponse([
          {
            id: 'first',
            query: 'небольшой порез',
            direction: 'russian_to_tsintskaro',
          },
        ]),
      )
      .mockResolvedValueOnce(
        toolResponse([
          { id: 'retry', query: 'порез', direction: 'russian_to_tsintskaro' },
        ]),
      )
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
            message: 'В словаре порез — чâсич.',
          }),
        ),
      );
    await expect(
      service.processBotMention('Баласи, как назвать небольшой порез?'),
    ).resolves.toEqual({
      action: 'reply',
      message: 'В словаре порез — чâсич.',
    });
    expect(dictionaryService.findByTranslation).toHaveBeenLastCalledWith(
      'порез',
    );
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(3);
  });

  it('gives the model current leaderboard data rather than routing by keywords', async () => {
    const { service, respond, dictionaryService } = makeService();
    const lookup = toolResponse([
      { id: 'leaders', query: '', direction: 'both' },
    ]);
    Object.assign(lookup.output[1], {
      name: 'get_dictionary_leaderboard',
      arguments: JSON.stringify({ limit: 3 }),
    });
    respond.mockResolvedValueOnce(lookup).mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
          message: 'alice добавила 12 слов.',
        }),
      ),
    );
    await expect(
      service.processBotMention(
        'Баласи, кто у нас больше всего пополнил словарь?',
      ),
    ).resolves.toEqual({ action: 'reply', message: 'alice добавила 12 слов.' });
    expect(dictionaryService.getLeaderboard).toHaveBeenCalledWith(3);
    const request = respond.mock.calls[1][0] as any;
    expect(JSON.parse(request.input.at(-1).output)).toEqual({
      leaders: [{ username: 'alice', wordsCount: 12 }],
    });
  });

  it('does not discard tool calls beyond the old eight-call limit', async () => {
    const { service, respond, dictionaryService } = makeService();
    const calls = Array.from({ length: 9 }, (_, i) => ({
      id: `call_${i}`,
      query: `слово ${i}`,
      direction: 'both' as const,
    }));
    respond.mockResolvedValueOnce(toolResponse(calls)).mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
          message: 'Проверены все девять слов.',
        }),
      ),
    );
    await service.processBotMention('Баласи, проверь девять слов');
    expect(dictionaryService.findWord).toHaveBeenCalledTimes(9);
    const request = respond.mock.calls[1][0] as any;
    expect(
      request.input
        .filter((m) => m.type === 'function_call_output')
        .map((m) => m.call_id),
    ).toEqual(calls.map((call) => call.id));
  });

  it('stops repeated searches with a final answer using the collected results', async () => {
    const { service, create, respond } = makeService();
    for (let i = 0; i < 8; i += 1) {
      respond.mockResolvedValueOnce(
        toolResponse([
          { id: `repeat_${i}`, query: 'слово', direction: 'both' },
        ]),
      );
    }
    respond.mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
          message:
            'По проверенным вариантам совпадений нет; полную проверку закончить не удалось.',
        }),
      ),
    );
    const result = await service.processBotMention('Баласи, найди слово');
    expect(result.action).toBe('reply');
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(9);
    const request = respond.mock.calls[8][0] as any;
    expect(request.tool_choice).toBe('none');
    expect(
      request.input.filter((m) => m.type === 'function_call_output'),
    ).toHaveLength(8);
    expect(request.input.at(-1).content).toContain(
      'не утверждай отсутствие слова только из-за лимита',
    );
  });

  it('retries a truncated answer with a larger token allowance and records both attempts', async () => {
    const { service, respond, usageService } = makeService();
    const truncated = response('{"message":"незаконченный');
    truncated.status = 'incomplete';
    (truncated as any).incomplete_details = { reason: 'max_output_tokens' };
    respond.mockResolvedValueOnce(truncated).mockResolvedValueOnce(
      response(
        JSON.stringify({
          action: 'reply',
          entries: [],
          words: [],
          text: null,
          message: 'Законченный подробный ответ.',
        }),
      ),
    );
    await expect(
      service.processBotMention('Баласи, объясни подробно'),
    ).resolves.toEqual({
      action: 'reply',
      message: 'Законченный подробный ответ.',
    });
    const retry = respond.mock.calls[1][0] as any;
    expect(retry.max_output_tokens).toBe(16000);
    expect(usageService.record).toHaveBeenCalledTimes(2);
    expect(usageService.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outputRetry: true }),
      }),
    );
  });

  it('repairs an unreadable answer while retaining prior dictionary results', async () => {
    const { service, respond } = makeService();
    respond
      .mockResolvedValueOnce(
        toolResponse([{ id: 'lookup', query: 'порез', direction: 'both' }]),
      )
      .mockResolvedValueOnce(response(''))
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
            message: 'По выполненному запросу совпадений нет.',
          }),
        ),
      );
    await expect(
      service.processBotMention('Баласи, найди порез'),
    ).resolves.toEqual({
      action: 'reply',
      message: 'По выполненному запросу совпадений нет.',
    });
    const retry = respond.mock.calls[2][0] as any;
    expect(retry.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'lookup',
        }),
      ]),
    );
    expect(retry.input.at(-1).content).toContain(
      'Сформируй непустой законченный ответ',
    );
  });

  it('returns a native Responses refusal without trying to parse it as JSON', async () => {
    const { service, respond } = makeService();
    respond.mockResolvedValueOnce({
      ...response(''),
      output: [
        {
          type: 'message',
          content: [
            { type: 'refusal', refusal: 'Не могу помочь с этой просьбой.' },
          ],
        },
      ],
    });
    await expect(service.processBotMention('Баласи, ответь')).resolves.toEqual({
      action: 'reply',
      message: 'Не могу помочь с этой просьбой.',
    });
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it('does not execute an action from a repeatedly truncated response', async () => {
    const { service, create, respond } = makeService();
    const truncated = response(
      JSON.stringify({ action: 'delete_words', words: ['дом'] }),
    );
    truncated.status = 'incomplete';
    (truncated as any).incomplete_details = { reason: 'max_output_tokens' };
    respond
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(truncated)
      .mockResolvedValueOnce(
        response(
          JSON.stringify({
            action: 'reply',
            entries: [],
            words: [],
            text: null,
            message: 'Уточни, что именно нужно сделать.',
          }),
        ),
      );
    await expect(
      service.processBotMention('Баласи, уточни запись про дом'),
    ).resolves.toEqual({
      action: 'reply',
      message: 'Уточни, что именно нужно сделать.',
    });
    expect(create).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledTimes(3);
    expect((respond.mock.calls[1][0] as any).max_output_tokens).toBe(16000);
  });
});
