import { TelegramUpdate } from './telegram.update';
import { WordReviewDecisionError } from '../word-review/word-review-decision';
import { DictionaryContentError } from '../dictionary/dictionary-content';

describe('TelegramUpdate bot mentions', () => {
  const makeUpdate = (senderUsername = 'AAlxnv') => {
    const dictionaryService = {
      applyActions: jest.fn(async (operations, actor, snapshots) => {
        void actor;
        void snapshots;
        return {
          unchanged: false,
          words: operations.map((op) => ({
            word: op.target ?? op.word,
            translation: '1) безделье; 2) перерыв; 3) ерунда',
            status: 'active',
            kind: 'word',
          })),
        };
      }),
      editRecord: jest.fn(async (edit) => ({
        status: 'updated',
        movedWord: edit.type === 'move_example' ? edit.word : undefined,
        previousTranslation: '1) бездельник',
        word: {
          word: edit.target ?? edit.word,
          translation: '1) бездельник; авара дурмах — бездельничать',
          status: 'active',
          kind: 'word',
        },
      })),
      getDeferredRecords: jest.fn(async () => []),
      upsertWord: jest.fn(async (input) => ({
        created: true,
        translationAdded: true,
        addedTranslation: input.translation,
        word: {
          word: input.word,
          translation: input.translation,
          partOfSpeech: input.partOfSpeech ?? null,
        },
      })),
      replaceTranslation: jest.fn(async (input) => ({
        status: 'updated',
        word: input.word,
        previousTranslation: 'старый перевод',
        translation: input.translation,
      })),
      updateWord: jest.fn(async (input) => ({
        status: 'updated',
        resolvedOldWord: input.oldWord,
        word: {
          word: input.newWord ?? input.oldWord,
          translation: input.translation ?? 'old translation',
          partOfSpeech: input.partOfSpeech ?? null,
        },
      })),
      deleteWords: jest.fn(async (words: string[]) => ({
        deleted: words,
        notFound: [] as string[],
      })),
      findWord: jest.fn(async () => undefined),
      findByTranslation: jest.fn(async () => []),
      findRelevantForPrompt: jest.fn(async () => []),
      getLeaderboard: jest.fn(async () => [
        { username: 'anonymous', wordsCount: 410 },
      ]),
    };
    const openaiService = {
      processBotMention: jest.fn(async () => ({
        action: 'reply',
        message: 'ok',
      })),
      normalizeDictionaryEntries: jest.fn(async () => []),
      analyzeDiscussion: jest.fn(async () => ({
        discussionSummary: '',
        words: [],
        discussionResult: {
          discussionSummary: '',
          agreedWords: [],
          disputedWords: [],
          totalExtracted: 0,
          duplicatesRemoved: 0,
        },
      })),
    };
    const telegramService = {
      saveContextMessage: jest.fn(async (message: any) => {
        void message;
      }),
      addMessage: jest.fn(async () => 1),
      getRecentMessages: jest.fn(async () => []),
      getBotMemory: jest.fn(async () => []),
      ensureDefaultGlobalMemory: jest.fn(),
      getActiveMessages: jest.fn(async () => []),
      getSummaryTarget: jest.fn(async () => null),
      createSummaryReport: jest.fn(async () => ({ id: 1 })),
      markMessagesReported: jest.fn(async () => undefined),
      setSummaryTarget: jest.fn(async () => undefined),
      clearSummaryTarget: jest.fn(async () => undefined),
      clearBuffer: jest.fn(async () => undefined),
      addBotMemory: jest.fn(async () => ({ id: 1 })),
      updateBotMemory: jest.fn(async () => ({ id: 1 })),
      deleteBotMemory: jest.fn(async () => true),
    };
    const wordReviewService = {
      setTarget: jest.fn(async () => ({})),
      clearTarget: jest.fn(async () => undefined),
      getTarget: jest.fn(async () => ({
        batchSize: 10,
        enabled: true,
        nextRunAt: new Date('2026-09-16T05:00:00Z'),
      })),
      setBatchSize: jest.fn(async () => ({ enabled: false })),
      getStatus: jest.fn(async () => ({
        target: null,
        totalWords: 0,
        sentWordCount: 0,
        remainingWordCount: 0,
        waitingNextPassCount: 0,
        lastSentAt: null,
        publishedBatchCount: 0,
        sendingBatchId: null,
      })),
      sendReviewBatch: jest.fn(async () => ({ status: 'sent', count: 10 })),
      isReviewMessage: jest.fn(async () => false),
      recordDecision: jest.fn(async (_input?: any) => {
        void _input;
        return {
          batchId: 5,
          completed: false,
          alreadyApplied: false,
          confirmed: [{ position: 1, word: 'ширин' }],
          disputed: [{ position: 2, word: 'спанах' }],
          pending: [{ position: 3, word: 'агошка' }],
        };
      }),
    };
    const openaiUsageService = {
      setReportTarget: jest.fn(async () => ({})),
      clearReportTarget: jest.fn(async () => undefined),
      getCalendarDayRange: jest.fn(() => ({
        start: new Date('2026-07-08T00:00:00.000Z'),
        end: new Date('2026-07-09T00:00:00.000Z'),
        label: '2026-07-08',
      })),
      buildReport: jest.fn(async () => 'usage report'),
    };
    const pollConfigService = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      clear: jest.fn(async () => undefined),
    };
    const pollScheduler = { sendBoth: jest.fn(async () => undefined) };
    const factDayConfigService = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
      disable: jest.fn(async () => true),
    };
    const factDayScheduler = { getFactsCount: jest.fn(() => 100) };
    const ctx = {
      chat: { id: -100, type: 'supergroup' },
      message: {},
      from: { id: 42, username: senderUsername },
      reply: jest.fn(),
      sendChatAction: jest.fn(async () => true),
      replyWithPhoto: jest.fn(),
      telegram: { setMessageReaction: jest.fn() },
    };
    const bot = {
      telegram: {
        setMyCommands: jest.fn(),
        sendMessage: jest.fn(async () => undefined),
      },
    };

    const config = {
      get: jest.fn((key: string): unknown =>
        key === 'wordReviewCoordinatorIds' ? [] : 100,
      ),
    };
    const update = new TelegramUpdate(
      bot as any,
      telegramService as any,
      openaiService as any,
      dictionaryService as any,
      pollConfigService as any,
      pollScheduler as any,
      factDayConfigService as any,
      factDayScheduler as any,
      wordReviewService as any,
      openaiUsageService as any,
      config as any,
    );

    return {
      update,
      ctx,
      dictionaryService,
      openaiService,
      telegramService,
      wordReviewService,
      pollConfigService,
      pollScheduler,
      factDayConfigService,
      openaiUsageService,
      bot,
      config,
    };
  };

  it.each([
    'Баласи, исправь:\n1. аваралых этмах — бездельничать, комментарий - заниматься ерундой; не имеет самостоятельного значения, необходимо перенести как пример слова аваралых\n2. авара дурмах — бездельничать (гл.), комментарий - не имеет самостоятельного значения, необходимо перенести как пример слова авара',
    'Баласи, перенеси «авара дурмах» в запись «авара» как пример к значению 1.',
    'Баласи, добавь вариант перевода: Аваралых - 3) ерунда.',
    'Баласи, авара дурмах пусть будет примером у авара, там где бездельник',
    'Баласи, исправь: аванс — удалить',
    'Баласи, слово «удалить» переведи как «позмах» и внеси в словарь',
  ])('sends arbitrary dictionary wording to the model: %s', async (text) => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('Elvardi');
    await (update as any).handleBotMention(ctx, text, 'Elvardi', 123, null);
    expect(
      (openaiService.processBotMention as jest.Mock).mock.calls[0][0],
    ).toBe(text);
    expect(dictionaryService.applyActions).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
    expect(dictionaryService.deleteWords).not.toHaveBeenCalled();
  });

  it('saves a multi-item model plan once with actual sender identity', async () => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('Elvardi');
    const operations = [
      {
        type: 'move_example',
        word: 'аваралых этмах',
        target: 'аваралых',
        sense: 3,
        translation: 'заниматься ерундой',
      },
      { type: 'move_example', word: 'авара дурмах', target: 'авара', sense: 1 },
    ];
    const snapshots = [{ word: 'авара', version: 'read-version' }];
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'dictionary_actions',
      operations,
      snapshots,
    } as any);
    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправь оба пункта',
      'spoofed-editor',
      123,
      77,
    );
    expect(dictionaryService.applyActions).toHaveBeenCalledTimes(1);
    expect(dictionaryService.applyActions).toHaveBeenCalledWith(
      operations,
      expect.objectContaining({
        userId: 42,
        username: 'Elvardi',
        chatId: -100,
        messageId: 123,
        threadId: 77,
        canRemoveEntry: true,
      }),
      snapshots,
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Изменения сохранены'),
      expect.anything(),
    );
  });

  it.each([
    { message: { forward_origin: { type: 'user' } } },
    { message: { forward_from: { username: 'Elvardi' } } },
    { message: { sender_chat: { id: -100 } } },
    { from: { id: 42, username: 'Elvardi', is_bot: true } },
  ])(
    'prevents model-proposed mutations from forwarded or anonymous messages: %j',
    async (overrides) => {
      const { update, ctx, dictionaryService, openaiService } =
        makeUpdate('Elvardi');
      Object.assign(ctx, overrides);
      openaiService.processBotMention.mockResolvedValueOnce({
        action: 'dictionary_actions',
        operations: [{ type: 'delete_word', word: 'авария' }],
        snapshots: [],
      } as any);
      await (update as any).handleBotMention(
        ctx,
        'Баласи, удали аварию',
        'Elvardi',
        123,
        null,
      );
      expect(dictionaryService.applyActions).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ readOnly: true }),
      );
    },
  );

  it('asks the model’s specific clarification without applying half a list', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'reply',
      message:
        'К какому значению «авара» привязать пример: 1) бездельник или 2) лентяй?',
    });
    await (update as any).handleBotMention(
      ctx,
      'Баласи, перенеси оба выражения в примеры',
      'AAlxnv',
      123,
      null,
    );
    expect(dictionaryService.applyActions).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('К какому значению'),
      expect.anything(),
    );
  });

  it('reports a rejected batch without claiming that some changes were saved', async () => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('Elvardi');
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'dictionary_actions',
      operations: [{ type: 'delete_word', word: 'авария' }],
      snapshots: [],
    } as any);
    dictionaryService.applyActions.mockRejectedValueOnce(
      new DictionaryContentError('Запись изменилась после чтения.'),
    );
    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправь',
      'Elvardi',
      123,
      null,
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      'Ничего не изменено. Запись изменилась после чтения.',
    );
  });

  it('lets the model handle a conversational leaderboard request', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    await (update as any).handleBotMention(
      ctx,
      'Баласи, покажи топ добавивших слова',
      'AAlxnv',
      123,
      null,
    );
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('sends formatted noun plural rules for /rules', async () => {
    const { update, ctx } = makeUpdate();

    await update.onRules(ctx as any);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('<b>Множественное число существительных</b>'),
      { parse_mode: 'HTML' },
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('<pre>Âв    → Âвлâр'),
      { parse_mode: 'HTML' },
    );
    expect((ctx.reply as jest.Mock).mock.calls[0][0].length).toBeLessThan(4096);
    expect(ctx.replyWithPhoto).not.toHaveBeenCalled();
  });

  it('configures text word review and sends a manual batch', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).from = { id: 1, username: 'AAlxnv' };

    (ctx as any).message = {
      text: '/setreviewchat',
      message_thread_id: 44,
    };
    await update.onSetReviewChat(ctx as any);

    expect(wordReviewService.setTarget).toHaveBeenCalledWith(
      -100,
      44,
      'AAlxnv',
    );
    expect(ctx.reply).not.toHaveBeenCalled();

    expect(wordReviewService.sendReviewBatch).toHaveBeenCalledWith({
      scheduled: true,
      chatId: -100,
      threadId: 44,
    });

    (ctx.reply as jest.Mock).mockClear();
    (ctx as any).message = { text: '/reviewnow', message_thread_id: 44 };
    await update.onReviewNow(ctx as any);

    expect(wordReviewService.sendReviewBatch).toHaveBeenLastCalledWith({
      extra: true,
      chatId: -100,
      threadId: 44,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it('pauses word delivery without clearing its settings', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).message = { text: '/stopreview', message_thread_id: 44 };
    await update.onStopReview(ctx as any);
    expect(wordReviewService.clearTarget).toHaveBeenCalledWith(-100, 44);
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it.each(['sent', 'not_due', 'no_words'])(
    'starts review silently when the result is %s',
    async (status) => {
      const { update, ctx, wordReviewService } = makeUpdate();
      ctx.message = { text: '/startreview', message_thread_id: 44 };
      wordReviewService.sendReviewBatch.mockResolvedValue({ status, count: 0 });
      await update.onStartReview(ctx as any);
      expect(wordReviewService.setTarget).toHaveBeenCalled();
      expect(wordReviewService.sendReviewBatch).toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
    },
  );

  it('reports a failed review delivery', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    ctx.message = { text: '/reviewnow', message_thread_id: 44 };
    wordReviewService.sendReviewBatch.mockRejectedValue(new Error('offline'));
    await update.onReviewNow(ctx as any);
    expect(ctx.reply).toHaveBeenCalledWith(
      'Ошибка при отправке слов на проверку.',
    );
  });

  it.each(['sent', 'no_words'])(
    'finishes a manual delivery silently when the result is %s',
    async (status) => {
      const { update, ctx, wordReviewService } = makeUpdate();
      ctx.message = { text: '/reviewnow', message_thread_id: 44 };
      wordReviewService.sendReviewBatch.mockResolvedValue({
        status,
        count: status === 'sent' ? 100 : 0,
      });
      await update.onReviewNow(ctx as any);
      expect(wordReviewService.sendReviewBatch).toHaveBeenCalledWith({
        extra: true,
        chatId: -100,
        threadId: 44,
      });
      expect(ctx.reply).not.toHaveBeenCalled();
    },
  );

  it('sets the next batch size in the current topic', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).message = {
      text: '/reviewsize@ourbot 100',
      message_thread_id: 44,
    };
    await update.onReviewSize(ctx as any);
    expect(wordReviewService.setBatchSize).toHaveBeenCalledWith(
      -100,
      44,
      100,
      'AAlxnv',
    );
    expect(wordReviewService.sendReviewBatch).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it.each([
    '/reviewsize',
    '/reviewsize 0',
    '/reviewsize -1',
    '/reviewsize 1.5',
    '/reviewsize 101',
    '/reviewsize 10 extra',
  ])('rejects malformed size command %s', async (text) => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).message = { text, message_thread_id: 44 };
    await update.onReviewSize(ctx as any);
    expect(wordReviewService.setBatchSize).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('от 1 до 100'),
    );
  });

  it('restricts review controls to administrators in group topics', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).from = { username: 'participant' };
    await update.onStartReview(ctx as any);
    await update.onStopReview(ctx as any);
    await update.onReviewSize(ctx as any);
    expect(wordReviewService.setTarget).not.toHaveBeenCalled();
    expect(wordReviewService.clearTarget).not.toHaveBeenCalled();
    expect(wordReviewService.setBatchSize).not.toHaveBeenCalled();
  });

  it('omits the removed translation slash command from the menu', async () => {
    const { update, bot } = makeUpdate();
    await update.onModuleInit();
    const commands = (bot.telegram.setMyCommands as jest.Mock).mock.calls[0][0];
    expect(
      commands.some((command) => command.command === 'settranslation'),
    ).toBe(false);
  });

  it('lets the model understand discussion in replies without mutating records', async () => {
    const {
      update,
      ctx,
      wordReviewService,
      telegramService,
      dictionaryService,
      openaiService,
    } = makeUpdate();
    (ctx as any).botInfo = { id: 900, username: 'ourbot' };
    (ctx as any).message = {
      message_id: 500,
      text: 'Не согласен, у ширин другой перевод',
      message_thread_id: 44,
      from: { id: 42, username: 'participant' },
      reply_to_message: { message_id: 777, from: { id: 900 } },
    };
    wordReviewService.isReviewMessage.mockResolvedValueOnce(true);
    await update.onText(ctx as any);
    expect(telegramService.saveContextMessage).toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(dictionaryService.applyActions).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
  });

  it('answers an explicit bot mention even when replying to a review list', async () => {
    const { update, ctx, wordReviewService, openaiService } = makeUpdate();
    (ctx as any).botInfo = { id: 900, username: 'ourbot' };
    (ctx as any).message = {
      message_id: 500,
      text: 'Баласи, объясни значение',
      message_thread_id: 44,
      from: { id: 42, username: 'participant' },
      reply_to_message: {
        message_id: 777,
        from: { id: 900 },
        text: 'список слов',
      },
    };
    wordReviewService.isReviewMessage.mockResolvedValueOnce(true);
    await update.onText(ctx as any);
    expect(openaiService.processBotMention).toHaveBeenCalled();
  });

  describe('explicit review outcomes in chat', () => {
    it('records an addressed decision and lists reviewed, disputed and pending words', async () => {
      const {
        update,
        ctx,
        wordReviewService,
        openaiService,
        dictionaryService,
      } = makeUpdate();
      (ctx as any).botInfo = { id: 900, username: 'ourbot' };
      ctx.message = {
        message_id: 500,
        message_thread_id: 44,
        text: 'Баласи, в партии №5 разобраны слова 1',
        from: ctx.from,
      };
      await update.onText(ctx as any);
      expect(wordReviewService.recordDecision).toHaveBeenCalledWith({
        request: { batchId: 5, mode: 'confirm', words: [{ position: 1 }] },
        chatId: -100,
        threadId: 44,
        replyToMessageId: undefined,
        userId: 42,
        username: 'AAlxnv',
        messageId: 500,
      });
      expect(ctx.reply).toHaveBeenCalledWith(
        '📝 Партия №5 разобрана частично (1 из 3).\n\nРазобраны:\n1. ширин\n\nСпорные — разбор продолжается:\n2. спанах\n\nОжидают итога:\n3. агошка',
        { reply_parameters: { message_id: 500 } },
      );
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
      expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    });

    it('accepts an explicit outcome replying to a batch without a bot mention', async () => {
      const { update, ctx, wordReviewService } = makeUpdate();
      (ctx as any).botInfo = { id: 900, username: 'ourbot' };
      ctx.message = {
        message_id: 500,
        message_thread_id: 44,
        text: 'Партия разобрана',
        from: ctx.from,
        reply_to_message: { message_id: 777, from: { id: 900 } },
      };
      wordReviewService.isReviewMessage.mockResolvedValueOnce(true);
      wordReviewService.recordDecision.mockResolvedValueOnce({
        batchId: 5,
        completed: true,
        alreadyApplied: false,
        confirmed: [{ position: 1, word: 'ширин' }],
        disputed: [],
        pending: [],
      });
      await update.onText(ctx as any);
      expect(wordReviewService.recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          request: { mode: 'all', words: [] },
          replyToMessageId: 777,
        }),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ Партия №5 разобрана полностью (1 из 1).'),
        expect.anything(),
      );
    });

    it('does not turn an unaddressed chat statement into a saved decision', async () => {
      const { update, ctx, wordReviewService, telegramService } = makeUpdate();
      ctx.message = {
        message_id: 500,
        message_thread_id: 44,
        text: 'Партия №5 разобрана',
        from: ctx.from,
      };
      await update.onText(ctx as any);
      expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
      expect(telegramService.addMessage).toHaveBeenCalled();
    });

    it('keeps tentative comments replying to a review list as discussion', async () => {
      const { update, ctx, wordReviewService, telegramService, openaiService } =
        makeUpdate();
      (ctx as any).botInfo = { id: 900, username: 'ourbot' };
      ctx.message = {
        message_id: 500,
        message_thread_id: 44,
        text: 'Слово ширин ещё не разобрано',
        from: ctx.from,
        reply_to_message: { message_id: 777, from: { id: 900 } },
      };
      wordReviewService.isReviewMessage.mockResolvedValueOnce(true);
      await update.onText(ctx as any);
      expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).toHaveBeenCalled();
      expect(telegramService.saveContextMessage).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalled();
    });

    it('does not let a participant close a batch', async () => {
      const { update, ctx, wordReviewService, openaiService } = makeUpdate();
      ctx.from = { id: 55, username: 'participant' };
      (ctx.telegram as any).getChatMember = jest.fn(async () => ({
        status: 'member',
      }));
      await (update as any).handleBotMention(
        ctx,
        'Баласи, партия №5 разобрана',
        'participant',
        500,
        44,
      );
      expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        'Подводить итоги могут назначенные координаторы и администраторы чата.',
      );
    });

    it('allows an appointed coordinator without requiring Telegram admin rights', async () => {
      const { update, ctx, wordReviewService, config } = makeUpdate();
      config.get.mockImplementation((key) =>
        key === 'wordReviewCoordinatorIds' ? [55] : 100,
      );
      ctx.from = { id: 55, username: 'coordinator' };
      await (update as any).handleBotMention(
        ctx,
        'Баласи, партия №5 разобрана',
        'coordinator',
        500,
        44,
      );
      expect(wordReviewService.recordDecision).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 55, username: 'coordinator' }),
      );
    });

    it.each([
      { sender_chat: { id: -100 } },
      { forward_origin: { type: 'user' } },
    ])('requires an attributable original message', async (message) => {
      const { update, ctx, wordReviewService } = makeUpdate();
      ctx.message = message;
      await (update as any).handleBotMention(
        ctx,
        'Баласи, партия №5 разобрана',
        'AAlxnv',
        500,
        44,
      );
      expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
    });

    it.each([
      'Баласи, партия №5 разобрана?',
      'Баласи, партия №5 не разобрана',
      'Баласи, партия №5 разобрана, но слово 3 ещё спорное',
    ])(
      'lets the model clarify an uncertain review comment without recording an outcome: %s',
      async (text) => {
        const { update, ctx, wordReviewService, openaiService } = makeUpdate();
        await (update as any).handleBotMention(ctx, text, 'AAlxnv', 500, 44);
        expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
        expect(openaiService.processBotMention).toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith('ok', expect.anything());
      },
    );

    it('reports unresolved words without a success message or AI fallback', async () => {
      const { update, ctx, wordReviewService, openaiService } = makeUpdate();
      wordReviewService.recordDecision.mockRejectedValueOnce(
        new WordReviewDecisionError('Слово №99 не найдено. Итог не сохранён.'),
      );
      await (update as any).handleBotMention(
        ctx,
        'Баласи, в партии №5 разобраны слова 1 и 99',
        'AAlxnv',
        500,
        44,
      );
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      expect(ctx.reply).toHaveBeenCalledWith(
        'Слово №99 не найдено. Итог не сохранён.',
      );
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
    });

    it('retains every reviewed word when the outcome spans multiple messages', async () => {
      const { update, ctx, wordReviewService } = makeUpdate();
      const confirmed = Array.from({ length: 100 }, (_, index) => ({
        position: index + 1,
        word: `слово${index}${'а'.repeat(150)}`,
      }));
      wordReviewService.recordDecision.mockResolvedValueOnce({
        batchId: 5,
        completed: true,
        alreadyApplied: false,
        confirmed,
        disputed: [],
        pending: [],
      });
      await (update as any).handleBotMention(
        ctx,
        'Баласи, партия №5 разобрана',
        'AAlxnv',
        500,
        44,
      );
      const chunks = ctx.reply.mock.calls.map((call) => call[0] as string);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every((chunk) => chunk.length <= 4000)).toBe(true);
      for (const word of confirmed)
        expect(chunks.join('')).toContain(`${word.position}. ${word.word}`);
    });
  });

  it('disables legacy review buttons without applying a vote or correction', async () => {
    const { update, ctx, dictionaryService } = makeUpdate();
    (ctx as any).answerCbQuery = jest.fn();
    (ctx as any).editMessageReplyMarkup = jest.fn();
    await update.onWordReviewAction(ctx as any);
    expect((ctx as any).editMessageReplyMarkup).toHaveBeenCalledWith({
      inline_keyboard: [],
    });
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
  });

  it('uses the model for a direct dictionary question with matching entries', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findWord.mockResolvedValueOnce({
      word: 'сахгкал оти',
      translation: 'укроп',
      partOfSpeech: 'сущ.',
    });

    await (update as any).handleBotMention(
      ctx,
      'Баласи, как перевести на русский «Сахгкал оти»?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('сахгкал оти');
    expect(dictionaryService.findByTranslation).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('searches both dictionary directions when translation direction is omitted', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'салам',
        translation: 'привет',
        partOfSpeech: 'междометие',
      },
    ]);

    await (update as any).handleBotMention(
      ctx,
      'Бот, как перевести слово привет?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('привет');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('привет');
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('answers the natural "как будет" translation wording from the dictionary', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'чâсич',
        translation: 'порез',
        partOfSpeech: null,
        source: 'chat',
      },
    ]);

    await (update as any).handleBotMention(
      ctx,
      'Баласи , как будет порез?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('порез');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('порез');
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('handles a short existence question without the word "словарь"', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findWord.mockResolvedValueOnce({
      word: 'есыр',
      translation: 'трудится не покладая сил',
      partOfSpeech: null,
    });

    await (update as any).handleBotMention(
      ctx,
      'Баласи, есть слово - есыр?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('есыр');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('есыр');
    expect(openaiService.processBotMention).toHaveBeenCalled();
  });

  it('lets the model resolve a local lookup miss using context and the dictionary tool', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Бот, как перевести слово привет?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('привет');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('привет');
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Бот, как перевести слово привет?',
      [],
      [],
      [],
    );
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('understands an explicit translation direction after the word', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      { word: 'салам', translation: 'привет', partOfSpeech: 'междометие' },
    ]);
    await (update as any).handleBotMention(
      ctx,
      'Бот, как перевести слово привет по-цинцкарски?',
      'AAlxnv',
      123,
      null,
    );
    expect(dictionaryService.findWord).not.toHaveBeenCalled();
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('привет');
    expect(openaiService.processBotMention).toHaveBeenCalled();
  });

  it('shows OpenAI diagnostics when a bot reply fails', async () => {
    const { update, ctx, openaiService } = makeUpdate();
    openaiService.processBotMention.mockRejectedValueOnce(
      Object.assign(new Error('Rate limit reached'), {
        status: 429,
        code: 'rate_limit_exceeded',
        request_id: 'req_bot_test',
      }),
    );

    await (update as any).handleBotMention(
      ctx,
      'Баласи, расскажи что-нибудь',
      'AAlxnv',
      123,
      null,
    );

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining(
        'OpenAI ограничил частоту запросов (HTTP 429, код: rate_limit_exceeded, request_id: req_bot_test)',
      ),
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('answers an explicit dictionary existence question in detail', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'махсыл',
        translation: 'урожай',
        partOfSpeech: 'существительное',
        source: 'etalon',
        comments: 'Общее название собранного урожая.',
      },
    ]);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, в словаре есть слово урожай?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('урожай');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('урожай');
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('reports the exact OpenAI stage and request id when report analysis fails', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    telegramService.getActiveMessages.mockResolvedValueOnce([
      {
        id: 1,
        chatId: -100,
        telegramMessageId: 10,
        text: 'Тестовое сообщение',
        username: 'user',
      },
    ]);
    openaiService.analyzeDiscussion.mockRejectedValueOnce(
      Object.assign(new Error('Rate limit reached'), {
        status: 429,
        code: 'rate_limit_exceeded',
        requestID: 'req_report_test',
      }),
    );

    await (update as any).generateReport(ctx, true);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Этап: анализ сообщений через OpenAI.'),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining(
        'OpenAI ограничил частоту запросов (HTTP 429, код: rate_limit_exceeded, request_id: req_report_test)',
      ),
    );
    expect(ctx.reply).not.toHaveBeenCalledWith('OpenAI API недоступен.');
  });

  it('identifies a database failure instead of blaming OpenAI', async () => {
    const { update, ctx, telegramService, openaiService } = makeUpdate();
    telegramService.getActiveMessages.mockRejectedValueOnce(
      Object.assign(new Error('connection refused'), {
        name: 'QueryFailedError',
        code: 'ECONNREFUSED',
      }),
    );

    await (update as any).generateReport(ctx, true);

    expect(openaiService.analyzeDiscussion).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Этап: загрузка сообщений из базы данных.'),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('ошибка базы данных (код: ECONNREFUSED)'),
    );
  });

  it('shows Telegram rejection details when report delivery fails', async () => {
    const { update, ctx, telegramService, bot } = makeUpdate();
    telegramService.getActiveMessages.mockResolvedValueOnce([
      {
        id: 1,
        chatId: -100,
        telegramMessageId: 10,
        text: 'Тестовое сообщение',
        username: 'user',
      },
    ]);
    bot.telegram.sendMessage.mockRejectedValueOnce({
      response: {
        error_code: 400,
        description: 'Bad Request: message thread not found',
      },
    });

    await (update as any).generateReport(ctx, true);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Этап: отправка отчёта в Telegram.'),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining(
        'Telegram отклонил сообщение (код Telegram: 400, Bad Request: message thread not found)',
      ),
    );
  });

  it('passes only matching dictionary entries into general AI context', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findWord.mockResolvedValueOnce({
      word: 'сахгкал оти',
      translation: 'укроп',
      partOfSpeech: null,
    });

    await (update as any).handleBotMention(
      ctx,
      'Баласи, составь пример со словом «Сахгкал оти»',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, составь пример со словом «Сахгкал оти»',
      [],
      [],
      [{ word: 'сахгкал оти', translation: 'укроп', partOfSpeech: null }],
    );
  });

  it('does not treat a complaint about leaders as a leaderboard request', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, почему присылается список лидеров?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.getLeaderboard).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith('ok', {
      reply_parameters: { message_id: 123 },
    });
  });

  it('preserves conversation and saved rules for a natural follow-up', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    const recentMessages = [
      {
        username: 'alice',
        text: 'Обсуждаем слово ширин.',
        sentAt: new Date('2026-07-15T08:00:00.000Z'),
      },
    ];
    const memory = [
      {
        text: 'Множественное число образуется по правилам цинцкарского языка.',
        createdBy: 'admin',
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
      },
    ];
    telegramService.getRecentMessages.mockResolvedValueOnce(recentMessages);
    telegramService.getBotMemory.mockResolvedValueOnce(memory);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, а во множественном числе?',
      'AAlxnv',
      123,
      42,
    );

    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, а во множественном числе?',
      recentMessages,
      memory,
      [],
    );
  });

  it('loads chat history and memory for an ordinary AI question', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, помоги красиво сформулировать объявление',
      'AAlxnv',
      123,
      null,
    );

    expect(telegramService.getRecentMessages).toHaveBeenCalledWith(
      -100,
      null,
      50,
    );
    expect(telegramService.getBotMemory).toHaveBeenCalledWith(-100, 50);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, помоги красиво сформулировать объявление',
      [],
      [],
      [],
    );
  });

  it('loads history and memory for a conversation summary request', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    const recentMessages = [
      {
        username: 'alice',
        text: 'Обсуждали встречу.',
        sentAt: new Date('2026-07-15T08:00:00.000Z'),
      },
    ];
    telegramService.getRecentMessages.mockResolvedValueOnce(recentMessages);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, о чём говорили в последних сообщениях?',
      'AAlxnv',
      123,
      null,
    );

    expect(telegramService.getRecentMessages).toHaveBeenCalledWith(
      -100,
      null,
      50,
    );
    expect(telegramService.getBotMemory).toHaveBeenCalledWith(-100, 50);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, о чём говорили в последних сообщениях?',
      recentMessages,
      [],
      [],
    );
  });

  it('loads memory and chat history for a community context question', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    const memory = [
      {
        text: 'Встреча Общества проходит летом.',
        createdBy: 'admin',
        createdAt: new Date('2026-07-15T08:00:00.000Z'),
      },
    ];
    telegramService.getBotMemory.mockResolvedValueOnce(memory);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, что известно о встрече Общества Цинцкаро?',
      'AAlxnv',
      123,
      null,
    );

    expect(telegramService.getRecentMessages).toHaveBeenCalledWith(
      -100,
      null,
      50,
    );
    expect(telegramService.getBotMemory).toHaveBeenCalledWith(-100, 50);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, что известно о встрече Общества Цинцкаро?',
      [],
      memory,
      [],
    );
  });
  it('answers a Telegram reply without repeating the bot name and passes the quoted message', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    Object.assign(ctx, { botInfo: { id: 900, username: 'balasi_bot' } });
    ctx.message = {
      message_id: 124,
      text: 'А во множественном числе?',
      date: 1784102460,
      from: { id: 1, username: 'alice' },
      message_thread_id: 42,
      reply_to_message: {
        message_id: 100,
        text: 'Âв — дом.',
        date: 1784000000,
        from: { id: 900, is_bot: true, username: 'balasi_bot' },
      },
    };
    ctx.reply.mockResolvedValueOnce({
      message_id: 125,
      text: 'Âвлâр — дома.',
      date: 1784102461,
      message_thread_id: 42,
      from: { username: 'balasi_bot' },
    });

    await update.onText(ctx as any);

    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'А во множественном числе?',
      [],
      [],
      [],
      expect.objectContaining({
        replyToMessage: expect.objectContaining({ text: 'Âв — дом.' }),
      }),
    );
    expect(telegramService.saveContextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100,
        threadId: 42,
        telegramMessageId: 124,
        text: 'А во множественном числе?',
        isBot: false,
      }),
    );
    expect(telegramService.saveContextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: -100,
        threadId: 42,
        telegramMessageId: 125,
        text: 'Âвлâр — дома.',
        isBot: true,
      }),
    );
    expect(telegramService.addMessage).not.toHaveBeenCalled();
  });

  it('does not answer replies to a different bot', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    Object.assign(ctx, { botInfo: { id: 900 } });
    ctx.message = {
      message_id: 124,
      text: 'Спасибо',
      from: { id: 1, username: 'alice' },
      reply_to_message: { message_id: 100, from: { id: 901, is_bot: true } },
    };
    await update.onText(ctx as any);
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(telegramService.addMessage).toHaveBeenCalled();
  });

  it('includes dictionary words from recent discussion for a pronoun follow-up', async () => {
    const { update, ctx, openaiService, telegramService, dictionaryService } =
      makeUpdate();
    const recent = [
      { username: 'alice', text: 'Обсуждаем слово ширин.', sentAt: new Date() },
    ];
    const entry = {
      word: 'ширин',
      translation: 'сладкий',
      partOfSpeech: undefined,
    };
    telegramService.getRecentMessages.mockResolvedValueOnce(recent);
    dictionaryService.findRelevantForPrompt.mockResolvedValueOnce([entry]);
    await (update as any).handleBotMention(
      ctx,
      'Баласи, расскажи про него',
      'alice',
      123,
      42,
    );
    expect(dictionaryService.findRelevantForPrompt).toHaveBeenCalledWith(
      ['Баласи, расскажи про него', 'Обсуждаем слово ширин.'],
      30,
    );
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, расскажи про него',
      recent,
      [],
      [entry],
    );
  });

  it('keeps a complete bot exchange for the next question without duplicating the current input', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();
    const history: any[] = [];
    telegramService.saveContextMessage.mockImplementation(
      async (message: any) => {
        history.push(message);
      },
    );
    telegramService.getRecentMessages.mockImplementation(async () => [
      ...history,
    ]);
    ctx.reply.mockImplementation(async (text) => ({
      message_id: 124,
      text,
      date: 1784102401,
    }));
    ctx.message = {
      message_id: 123,
      text: 'Баласи, помоги с объявлением о встрече',
      date: 1784102400,
      from: { username: 'alice' },
    };
    await update.onText(ctx as any);
    ctx.message = {
      message_id: 125,
      text: 'Баласи, сделай его короче',
      date: 1784102402,
      from: { username: 'alice' },
    };
    await update.onText(ctx as any);
    const secondHistory = (
      openaiService.processBotMention.mock.calls[1] as any[]
    )[1] as any[];
    expect(secondHistory.map((message) => message.text)).toEqual([
      'Баласи, помоги с объявлением о встрече',
      'ok',
    ]);
    expect(secondHistory[1].isBot).toBe(true);
  });

  it('keeps the context character budget when the newest message is oversized', () => {
    const { update } = makeUpdate();
    const history = [
      { username: 'alice', text: 'а'.repeat(20000), sentAt: new Date() },
    ];
    const result = (update as any).limitRecentMessagesByChars(history, 12000);
    expect(result).toHaveLength(1);
    expect(
      result[0].text.length + result[0].username.length + 24,
    ).toBeLessThanOrEqual(12000);
  });

  it('uses context when a translation request refers to the previous word', async () => {
    const { update, ctx, openaiService, telegramService, dictionaryService } =
      makeUpdate();
    const history = [{ username: 'alice', text: 'Хатâ', sentAt: new Date() }];
    telegramService.getRecentMessages.mockResolvedValueOnce(history);
    dictionaryService.findByTranslation.mockResolvedValue([
      { word: 'онун', translation: 'его' },
    ]);
    await (update as any).handleBotMention(
      ctx,
      'Баласи, переведи его',
      'alice',
      123,
      null,
    );
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, переведи его',
      history,
      [],
      expect.any(Array),
    );
  });
  it('uses the model to answer every part of a question even when the dictionary word is found', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    dictionaryService.findWord.mockResolvedValueOnce({
      word: 'сахгкал оти',
      translation: 'укроп',
      partOfSpeech: 'сущ.',
    });
    const question =
      'Баласи, что значит «сахгкал оти»? Объясни подробнее и помоги запомнить.';
    await (update as any).handleBotMention(ctx, question, 'alice', 123, null);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      question,
      [],
      [],
      [expect.objectContaining({ word: 'сахгкал оти', translation: 'укроп' })],
    );
  });

  it('delivers a detailed AI answer in full across Telegram-sized messages', async () => {
    const { update, ctx, openaiService } = makeUpdate();
    const answer = 'Подробно: ' + '🌿'.repeat(4500) + '\nКонец ответа.';
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'reply',
      message: answer,
    });
    await (update as any).handleBotMention(
      ctx,
      'Баласи, объясни подробно',
      'alice',
      123,
      null,
    );
    const chunks = ctx.reply.mock.calls.map((call) => call[0]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((text) => text.length <= 4000)).toBe(true);
    expect(chunks.join('')).toBe(answer);
    expect(chunks.every((text) => !/[\uD800-\uDBFF]$/.test(text))).toBe(true);
  });
});
