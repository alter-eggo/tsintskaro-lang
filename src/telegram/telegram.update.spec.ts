import { TelegramUpdate } from './telegram.update';
import { WordReviewDecisionError } from '../word-review/word-review-decision';
import { DictionaryService } from '../dictionary/dictionary.service';
import { TRANSLATION_EDIT_DENIED } from '../dictionary/translation-permissions';

describe('TelegramUpdate bot mentions', () => {
  const makeUpdate = (senderUsername = 'AAlxnv') => {
    const dictionaryService = {
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
    const pollConfigService = { get: jest.fn(async () => null) };
    const factDayConfigService = {
      get: jest.fn(async () => null),
      set: jest.fn(async () => undefined),
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
      {} as any,
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
      factDayConfigService,
      openaiUsageService,
      bot,
      config,
    };
  };

  it.each([
    'onSummaryThreadStatus',
    'onPollStatus',
    'onReviewStatus',
    'onFactDayStatus',
  ] as const)(
    '%s displays stored timestamps in Moscow time across midnight',
    async (command) => {
      const {
        update,
        ctx,
        telegramService,
        pollConfigService,
        factDayConfigService,
        wordReviewService,
      } = makeUpdate();
      const target = {
        chatId: -100,
        threadId: 44,
        setBy: 'AAlxnv',
        setAt: '2026-09-14T21:30:00Z',
        nextFactIndex: 0,
        enabled: true,
        batchSize: 10,
        nextRunAt: new Date('2026-09-16T05:00:00Z'),
      };
      telegramService.getSummaryTarget.mockResolvedValueOnce(target as any);
      pollConfigService.get.mockResolvedValueOnce(target);
      factDayConfigService.get.mockResolvedValueOnce(target);
      wordReviewService.getStatus.mockResolvedValueOnce({
        target,
        lastSentAt: new Date('2026-09-14T20:30:00Z'),
      } as any);

      await update[command](ctx as any);

      const reply = ctx.reply.mock.calls[0][0];
      expect(reply).toContain('когда: 15.09.2026, 00:30 МСК');
      expect(reply).not.toMatch(/Asia\/Tbilisi|по Тбилиси|T21:30/);
      if (command === 'onReviewStatus') {
        expect(reply).toContain('Последняя отправка: 14.09.2026, 23:30 МСК');
        expect(reply).toContain('Ближайшая отправка: 16.09.2026, 08:00 МСК');
        expect(reply).toContain('каждые 3 дня в 08:00 МСК');
      }
      if (command === 'onFactDayStatus') {
        expect(reply).toContain('07:00, 09:00, 17:00, 19:00 и 21:00 МСК');
      }
    },
  );

  it('announces daily token reports at the existing delivery time in Moscow', async () => {
    const { update, ctx } = makeUpdate();
    await update.onSetTokenReport(ctx as any);
    expect(ctx.reply.mock.calls[0][0]).toContain('каждый день в 08:00 МСК');
  });

  it.each(['2026-09-15-00', '2026-09-15-24'])(
    'shows the Moscow date for a history quiz sent in Tbilisi slot %s',
    async (lastSentSlot) => {
      const { update, ctx, factDayConfigService } = makeUpdate();
      factDayConfigService.get.mockResolvedValueOnce({
        setAt: new Date('2026-09-14T20:30:00Z'),
        nextFactIndex: 0,
        lastSentDate: '2026-09-15',
        lastSentSlot,
      });
      await update.onFactDayStatus(ctx as any);
      expect(ctx.reply.mock.calls[0][0]).toContain(
        'последняя отправка: 14.09.2026 МСК',
      );
    },
  );

  it('adds a direct word list before considering leaderboard mentions', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    const text = `Баласи, не присылай список лидеров, он пока не нужен, только добавь эти слова:
Хабâрь джâтûрмах - принести известие;
Хам адам - посторонний человек;
Сыхтырма бâни - не прижимай ( не души) меня;
Хатâ - проблема; неприятность;
Башûмâ хатâ олди - свалилась проблема на голову;
Дамджûламах - капать;
Ягхыш дамджûлûûрь - капает дождь;
Ягхыш джûдûûрь - идёт дождь;
Бâннâн отŷри - насчёт меня;
Сâннâн отŷри - насчёт тебя ;
Тâрсû - всё наоборот;
Тâрс джûдûûр - не по плану;
Олдугхи джŷн  гхурия - негативное пожелание;
Дырмыхламах - собирать вилами стог сена;
Фысыламах - сдуться; выпустить воздух;
Топум фысыланди  - мой мяч сдулся;
Джŷвâдж - глиняный кувшин;
Урум - грек;
Ширин - сладкий; сахарный;
Дûрâч - столб в основании дома ;
Догхмах - роды у животных;
Эрчâч - бычок;
Мыных - котёнок;
Мыныхлар - котята;
Гудич - щенок;
Тоспагха - черепаха;
Мûсûр - индюк;
Шûла-пûлав - поминальное блюдо;
Хашлама - варёная баранина;
Хашламах - обварить;
Спанах - шпинат;
Шамар - оплеуха; шлепок;
Шамар иâджâхсын - получишь взбучку;
Кордŷджŷм - узелок;

🏆 Топ добавивших слова:
1. @anonymous — 410 слов`;

    await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

    expect(dictionaryService.getLeaderboard).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(34);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'хабâрь джâтûрмах',
      translation: 'принести известие',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(34, {
      word: 'кордŷджŷм',
      translation: 'узелок',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenCalledWith({
      word: 'шûла-пûлав',
      translation: 'поминальное блюдо',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ записал (34):'),
      { reply_parameters: { message_id: 123 } },
    );
    expect(ctx.telegram.setMessageReaction).not.toHaveBeenCalled();
  });

  it('adds a direct word list when the dash touches the word', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    const text = `Бот, проанализируй и добавь слова:
Âйсûч- меньше,  нехватка,
Артых - лишнее,
Артых âйсûч сôйлâмâ- лишнего не болтай,
Ŷшŷч- простуда,
Вурух- ушиб,
Сахглам- здоровый,
Джŷмâнни- в положении, ( беременная),
Ушах этмах- рожать,
Мeшâт этмах- помешать кому- то,
Дамламах- капать,
Урâч гхарышмах- тошнота, тошнить,
Аяхланмах- встать на ноги,(выздороветь),
Гхолтух- подмышка,
Гхолтухгун алти- под  мышкой,
Гыгарт - клюв,
Чâнджâ- челюсть,
Бурнун дâлиджи- ноздря,
Дирсâч- локоть,
Гхабурхга- ребро`;

    await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(19);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'âйсûч',
      translation: 'меньше, нехватка',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(3, {
      word: 'артых âйсûч сôйлâмâ',
      translation: 'лишнего не болтай',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(7, {
      word: 'джŷмâнни',
      translation: 'в положении, ( беременная)',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(12, {
      word: 'аяхланмах',
      translation: 'встать на ноги,(выздороветь)',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(19, {
      word: 'гхабурхга',
      translation: 'ребро',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ записал (19):'),
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('keeps a comma-separated expression as one entry after "добавь:"', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, добавь: Артын, âйсилмâин, дашын ,тôчŷлмâин!- Плодитесь, размножайтесь и наполняйте Землю!',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.normalizeDictionaryEntries).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(1);
    expect(dictionaryService.upsertWord).toHaveBeenCalledWith({
      word: 'артын, âйсилмâин, дашын, тôчŷлмâин',
      translation: 'Плодитесь, размножайтесь и наполняйте Землю',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      '✅ записал:\n• артын, âйсилмâин, дашын, тôчŷлмâин — Плодитесь, размножайтесь и наполняйте Землю',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('preserves the exact headword from the reported regression', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, добавь сёир ётмах - смотреть, наблюдать.',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.normalizeDictionaryEntries).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledWith({
      word: 'сёир ётмах',
      translation: 'смотреть, наблюдать',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      '✅ записал:\n• сёир ётмах — смотреть, наблюдать',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('parses common Unicode dash variants without AI', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    for (const separator of ['–', '−', '‑']) {
      await (update as any).handleBotMention(
        ctx,
        `Баласи, добавь сёир ётмах ${separator} смотреть, наблюдать.`,
        'AAlxnv',
        123,
        null,
      );
    }

    expect(openaiService.normalizeDictionaryEntries).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(3);
    for (const call of dictionaryService.upsertWord.mock.calls) {
      expect(call[0]).toEqual({
        word: 'сёир ётмах',
        translation: 'смотреть, наблюдать',
        partOfSpeech: null,
        addedBy: 'AAlxnv',
      });
    }
  });

  it('rejects an AI action that substitutes a different headword', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'add_words',
      entries: [
        {
          word: 'сŷртмах',
          translation: 'смотреть, наблюдать',
          partOfSpeech: null,
        },
      ],
    } as any);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, добавь запись сёир ётмах / смотреть, наблюдать.',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      '⚠️ Не стал сохранять запись: распознанные слово и перевод не совпали с текстом сообщения. Напиши в формате «слово — перевод».',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('does not save an AI placeholder as a dictionary translation', async () => {
    const { update, ctx, dictionaryService } = makeUpdate();

    await (update as any).handleDictionaryAdditions(ctx, -100, 'AAlxnv', 123, [
      {
        word: 'артын',
        translation: '(не найдено цинцкарское слово с явным переводом)',
        partOfSpeech: null,
      },
    ]);

    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      '⚠️ не получилось сохранить: артын',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('uses AI normalization when a direct word list is not fully parseable', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    openaiService.normalizeDictionaryEntries.mockResolvedValueOnce([
      {
        word: 'âйсûч',
        translation: 'меньше, нехватка',
        partOfSpeech: null,
      },
      { word: 'артых', translation: 'лишнее', partOfSpeech: null },
    ]);

    await (update as any).handleBotMention(
      ctx,
      `Бот, проверь и добавь слова:
Âйсûч меньше, нехватка
Артых - лишнее`,
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.normalizeDictionaryEntries).toHaveBeenCalledWith(
      `проверь и добавь слова:
Âйсûч меньше, нехватка
Артых - лишнее`,
    );
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(2);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'âйсûч',
      translation: 'меньше, нехватка',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(2, {
      word: 'артых',
      translation: 'лишнее',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
  });

  it('adds several direct word pairs from one semicolon-separated line', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Бот, добавь Хатâ - проблема; неприятность; Артых - лишнее; Ширин - сладкий; сахарный',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(3);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'хатâ',
      translation: 'проблема; неприятность',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(2, {
      word: 'артых',
      translation: 'лишнее',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(3, {
      word: 'ширин',
      translation: 'сладкий; сахарный',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
  });

  it('reports only the translation variant that was actually added', async () => {
    const { update, ctx, dictionaryService } = makeUpdate();
    dictionaryService.upsertWord.mockResolvedValueOnce({
      created: false,
      translationAdded: true,
      addedTranslation: 'приятный',
      word: {
        word: 'ширин',
        translation: 'приятный; сладкий, сахарный',
        partOfSpeech: null,
      },
    });

    await (update as any).handleBotMention(
      ctx,
      'Бот, добавь Ширин - сахарный; приятный',
      'AAlxnv',
      123,
      null,
    );

    expect(ctx.reply).toHaveBeenCalledWith(
      '➕ добавил перевод к слову:\n• ширин — приятный',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('adds direct word pairs written with colons', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      `Бот, добавь слова:
Хатâ: проблема
Артых: лишнее`,
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(2);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'хатâ',
      translation: 'проблема',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(2, {
      word: 'артых',
      translation: 'лишнее',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
  });

  it('sanitizes dictionary command noise before saving words', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      `Бот, добавь слова:
в словарь аслан - лев
- бышхи - мелкозубчатая пила
юва - гнездо (нет в словаре) (сущ.)
сŷпŷpджâ - веник`,
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledTimes(4);
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(1, {
      word: 'аслан',
      translation: 'лев',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(2, {
      word: 'бышхи',
      translation: 'мелкозубчатая пила',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(3, {
      word: 'юва',
      translation: 'гнездо',
      partOfSpeech: 'сущ.',
      addedBy: 'AAlxnv',
    });
    expect(dictionaryService.upsertWord).toHaveBeenNthCalledWith(4, {
      word: 'сŷпŷрджâ',
      translation: 'веник',
      partOfSpeech: null,
      addedBy: 'AAlxnv',
    });
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
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Разбор слов запущен в этой теме'),
    );
    expect(ctx.reply.mock.calls[0][0]).toContain('каждые 3 дня в 08:00 МСК');
    expect(ctx.reply.mock.calls[0][0]).toContain('16.09.2026, 08:00 МСК');

    (ctx.reply as jest.Mock).mockClear();
    (ctx as any).message = { text: '/reviewnow', message_thread_id: 44 };
    await update.onReviewNow(ctx as any);

    expect(wordReviewService.sendReviewBatch).toHaveBeenLastCalledWith({
      extra: true,
      chatId: -100,
      threadId: 44,
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      '✅ Дополнительная партия: 10 слов. Регулярное расписание сохранено.',
    );
  });

  it('pauses word delivery without clearing its settings', async () => {
    const { update, ctx, wordReviewService } = makeUpdate();
    (ctx as any).message = { text: '/stopreview', message_thread_id: 44 };
    await update.onStopReview(ctx as any);
    expect(wordReviewService.clearTarget).toHaveBeenCalledWith(-100, 44);
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('прогресс сохранены'),
    );
  });

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

  it.each([
    ['Баласи, замени перевод слова ширин на сладкий', 'ширин', 'сладкий'],
    [
      'Бот, замени перевод сахгкал оти на укроп; растение',
      'сахгкал оти',
      'укроп; растение',
    ],
    ['Баласи, поменяй перевод ширин на — сладкий', 'ширин', 'сладкий'],
    [
      'Баласи, пожалуйста, исправь перевод у слова ширин на сладкий',
      'ширин',
      'сладкий',
    ],
  ])(
    'replaces the full translation through ordinary wording: %s',
    async (text, word, translation) => {
      const { update, ctx, dictionaryService, openaiService } = makeUpdate();
      (ctx as any).from = { id: 42, username: 'joanofarc74' };
      (ctx as any).message = { text, message_id: 777, message_thread_id: 44 };
      await (update as any).handleBotMention(ctx, text, 'joanofarc74', 777, 44);
      expect(dictionaryService.replaceTranslation).toHaveBeenCalledWith({
        word,
        translation,
        userId: 42,
        username: 'joanofarc74',
        chatId: -100,
        threadId: 44,
        messageId: 777,
      });
      expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
      expect(dictionaryService.updateWord).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Было: старый перевод'),
        { reply_parameters: { message_id: 777 } },
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(`Стало: ${translation}`),
        { reply_parameters: { message_id: 777 } },
      );
    },
  );

  it('resolves a short translation replacement from the replied-to message', async () => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('joanofarc74');
    (ctx as any).botInfo = { id: 900, username: 'ourbot' };
    (ctx as any).message = {
      message_id: 500,
      text: 'замени перевод на сладкий',
      message_thread_id: 44,
      from: { id: 42, username: 'participant' },
      reply_to_message: {
        message_id: 777,
        text: 'ширин — сахарный',
        date: 1789286400,
        from: { id: 900, is_bot: true, username: 'ourbot' },
      },
    };
    (openaiService.processBotMention as jest.Mock).mockResolvedValueOnce({
      action: 'update_words',
      entries: [{ oldWord: 'ширин', newWord: null, translation: 'сладкий' }],
    });
    await update.onText(ctx as any);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'замени перевод на сладкий',
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({
        forceAction: true,
        replyToMessage: expect.objectContaining({ text: 'ширин — сахарный' }),
      }),
    );
    expect(dictionaryService.replaceTranslation).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'ширин', translation: 'сладкий' }),
    );
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
  });

  it('asks which word when a short replacement refers to an entire batch', async () => {
    const { update, ctx, dictionaryService, openaiService, wordReviewService } =
      makeUpdate();
    (ctx as any).botInfo = { id: 900, username: 'ourbot' };
    (ctx as any).message = {
      message_id: 500,
      text: 'замени перевод на сладкий',
      message_thread_id: 44,
      from: { id: 42, username: 'participant' },
      reply_to_message: {
        message_id: 777,
        text: '1. ширин — сахарный\n2. хатâ — проблема',
        date: 1789286400,
        from: { id: 900, is_bot: true },
      },
    };
    wordReviewService.isReviewMessage.mockResolvedValueOnce(true);
    (openaiService.processBotMention as jest.Mock).mockResolvedValueOnce({
      action: 'reply',
      message: 'У какого слова заменить перевод?',
    });
    await update.onText(ctx as any);
    expect(openaiService.processBotMention).toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      'У какого слова заменить перевод?',
      expect.any(Object),
    );
    expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
  });

  it('never turns a correction request into an appended translation if the model picks the wrong action', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    (openaiService.processBotMention as jest.Mock).mockResolvedValueOnce({
      action: 'add_words',
      entries: [{ word: 'ширин', translation: 'сладкий', partOfSpeech: null }],
    });
    await (update as any).handleBotMention(
      ctx,
      'Баласи, можешь заменить перевод ширин на сладкий?',
      'AAlxnv',
      123,
      null,
    );
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('Какое слово'),
    );
  });

  it('continues to append a meaning when explicitly asked to add it', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    (openaiService.processBotMention as jest.Mock).mockResolvedValueOnce({
      action: 'add_words',
      entries: [{ word: 'ширин', translation: 'приятный', partOfSpeech: null }],
    });
    await (update as any).handleBotMention(
      ctx,
      'Баласи, добавь ещё значение: ширин — приятный',
      'AAlxnv',
      123,
      null,
    );
    expect(dictionaryService.upsertWord).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'ширин', translation: 'приятный' }),
    );
    expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
  });

  describe('translation editor access', () => {
    it.each(['joanofarc74', 'ekaterina_karaasheva', 'JoanOfArc74'])(
      'allows %s without requiring administrator rights',
      async (username) => {
        const { update, ctx, dictionaryService } = makeUpdate(username);
        (ctx.telegram as any).getChatMember = jest.fn(async () => ({
          status: 'member',
        }));
        await (update as any).handleBotMention(
          ctx,
          'Баласи, замени перевод слова ширин на приятный',
          username,
          700,
          44,
        );
        expect(dictionaryService.replaceTranslation).toHaveBeenCalledWith(
          expect.objectContaining({
            username,
            userId: 42,
            word: 'ширин',
            translation: 'приятный',
          }),
        );
        expect((ctx.telegram as any).getChatMember).not.toHaveBeenCalled();
      },
    );

    it.each(['participant', 'AAlxnv', 'MEMazmanova', 'joanofarc74_fake'])(
      'denies %s even when they are an administrator or claim an editor username in text',
      async (username) => {
        const { update, ctx, dictionaryService, openaiService } =
          makeUpdate(username);
        (ctx.telegram as any).getChatMember = jest.fn(async () => ({
          status: 'administrator',
        }));
        await (update as any).handleBotMention(
          ctx,
          'Баласи, замени перевод слова ширин на приятный',
          'joanofarc74',
          700,
          44,
        );
        expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
        expect(dictionaryService.updateWord).not.toHaveBeenCalled();
        expect(openaiService.processBotMention).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining(TRANSLATION_EDIT_DENIED),
          expect.anything(),
        );
      },
    );

    it.each([
      { from: { id: 42, first_name: 'joanofarc74' } },
      { from: { id: 42, username: 'joanofarc74', is_bot: true } },
      {
        from: { id: 42, username: 'joanofarc74' },
        message: { sender_chat: { id: -100 } },
      },
    ])(
      'does not grant editor access from a display name, bot or anonymous sender',
      async (overrides) => {
        const { update, ctx, dictionaryService } = makeUpdate();
        Object.assign(ctx, overrides);
        await (update as any).handleBotMention(
          ctx,
          'Баласи, замени перевод слова ширин на приятный',
          'joanofarc74',
          700,
          44,
        );
        expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining(TRANSLATION_EDIT_DENIED),
          expect.anything(),
        );
      },
    );

    it('rejects a translation edit extracted by AI, including a simultaneous rename', async () => {
      const { update, ctx, dictionaryService, openaiService } =
        makeUpdate('participant');
      (openaiService.processBotMention as jest.Mock).mockResolvedValueOnce({
        action: 'update_words',
        entries: [
          { oldWord: 'ширин', newWord: 'шырин', translation: 'приятный' },
        ],
      });
      await (update as any).handleBotMention(
        ctx,
        'Баласи, можно поправить эту запись по нашему обсуждению?',
        'participant',
        700,
        44,
      );
      expect(openaiService.processBotMention).toHaveBeenCalled();
      expect(dictionaryService.updateWord).not.toHaveBeenCalled();
      expect(dictionaryService.replaceTranslation).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(TRANSLATION_EDIT_DENIED),
        expect.anything(),
      );
    });

    it('adds new words but refuses changed meanings in a mixed word list from another participant', async () => {
      const { update, ctx, dictionaryService } = makeUpdate('participant');
      const existing = {
        id: 1,
        word: 'ширин',
        translation: 'сладкий',
        partOfSpeech: null,
      };
      const repo = {
        findOne: jest.fn(async ({ where }) =>
          where.word === existing.word ? { ...existing } : null,
        ),
        find: jest.fn(async () => [{ ...existing }]),
        create: jest.fn((value) => ({ id: 2, ...value })),
        save: jest.fn(async (value) => value),
      };
      const service = new DictionaryService(repo as any);
      (dictionaryService.upsertWord as jest.Mock).mockImplementation((value) =>
        service.upsertWord(value),
      );
      await (update as any).handleDictionaryAdditions(
        ctx,
        -100,
        'joanofarc74',
        700,
        [
          { word: 'ширин', translation: 'приятный' },
          { word: 'хатâ', translation: 'проблема' },
        ],
      );
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ word: 'хатâ', addedBy: 'participant' }),
      );
      expect(existing.translation).toBe('сладкий');
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining(TRANSLATION_EDIT_DENIED),
        expect.anything(),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ записал:'),
        expect.anything(),
      );
      expect(ctx.reply).not.toHaveBeenCalledWith(
        expect.stringContaining('➕ добавил'),
        expect.anything(),
      );
    });
  });

  it('omits the removed translation slash command from the menu', async () => {
    const { update, bot } = makeUpdate();
    await update.onModuleInit();
    const commands = (bot.telegram.setMyCommands as jest.Mock).mock.calls[0][0];
    expect(
      commands.some((command) => command.command === 'settranslation'),
    ).toBe(false);
  });

  it('keeps replies to review lists as participant discussion rather than bot actions', async () => {
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
    expect(wordReviewService.isReviewMessage).toHaveBeenCalledWith(-100, 777);
    expect(telegramService.addMessage).toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
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
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(telegramService.addMessage).toHaveBeenCalled();
      expect(ctx.reply).not.toHaveBeenCalled();
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
      'asks for an explicit outcome without sending unclear instructions to AI: %s',
      async (text) => {
        const { update, ctx, wordReviewService, openaiService } = makeUpdate();
        await (update as any).handleBotMention(ctx, text, 'AAlxnv', 500, 44);
        expect(wordReviewService.recordDecision).not.toHaveBeenCalled();
        expect(openaiService.processBotMention).not.toHaveBeenCalled();
        expect(ctx.reply).toHaveBeenCalledWith(
          expect.stringContaining('Итог не изменён.'),
        );
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

  it('corrects spelling by translation instead of adding a bad word', async () => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('joanofarc74');
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'сагхал оти',
        translation: 'укроп',
        partOfSpeech: null,
      },
    ]);

    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправь правописание слова сахгкал оти - укроп',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).toHaveBeenCalledWith({
      oldWord: 'сагхал оти',
      newWord: 'сахгкал оти',
      translation: 'укроп',
      partOfSpeech: undefined,
      updatedBy: 'joanofarc74',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ поправил:'),
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('does not create a word when spelling correction cannot be matched', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправь правописание слова сахгкал оти - укроп',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      '⚠️ не нашёл в словаре слово с переводом «укроп». Не стал создавать новую запись.',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it.each([
    [
      'Баласи, исправь словосочетание яначчынын дâ шââтӱ на яланчынын дâ шââтӱ - говорилось после чихания собеседника, как подтверждение правильности слов',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      'говорилось после чихания собеседника, как подтверждение правильности слов',
    ],
    [
      'Баласи, пожалуйста, замените фразу яначчынын дâ шââтӱ на яланчынын дâ шââтӱ, перевод: подтверждение правильности слов',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      'подтверждение правильности слов',
    ],
    [
      'Бот, поправьте, пожалуйста, в словосочетании яначчынын дâ шââтӱ: должно быть яланчынын дâ шââтӱ — подтверждение правильности слов',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      'подтверждение правильности слов',
    ],
    [
      'Баласи, поменяй: не яначчынын дâ шââтӱ, а правильно яланчынын дâ шââтӱ',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      null,
    ],
    [
      'Баласи, исправьте пожалуйста написание словосочетания яначчынын дâ шââтӱ на яланчынын дâ шââтӱ',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      null,
    ],
    [
      'Бот, скорректируйте выражение яначчынын дâ шââтӱ нужно заменить на яланчынын дâ шââтӱ - подтверждение правильности слов',
      'яначчынын дâ шââтӱ',
      'яланчынын дâ шââтӱ',
      'подтверждение правильности слов',
    ],
  ])(
    'understands conversational dictionary corrections: %s',
    async (text, oldWord, newWord, translation) => {
      const { update, ctx, dictionaryService, openaiService } =
        makeUpdate('joanofarc74');

      await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

      expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(dictionaryService.updateWord).toHaveBeenCalledWith({
        oldWord,
        newWord,
        translation,
        partOfSpeech: undefined,
        updatedBy: 'joanofarc74',
      });
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ поправил:'),
        { reply_parameters: { message_id: 123 } },
      );
    },
  );

  it('understands a natural command that only changes a translation', async () => {
    const { update, ctx, dictionaryService, openaiService } =
      makeUpdate('joanofarc74');

    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправьте перевод словосочетания яланчынын дâ шââтӱ на подтверждение правильности слов',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.replaceTranslation).toHaveBeenCalledWith({
      word: 'яланчынын дâ шââтӱ',
      translation: 'подтверждение правильности слов',
      userId: 42,
      username: 'joanofarc74',
      chatId: -100,
      threadId: null,
      messageId: 123,
    });
  });

  it('falls back to the AI action agent for an unparsed dictionary correction', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    const text =
      'Баласи, можно, пожалуйста, поправить ошибку в записи: раньше было яначчынын дâ шââтӱ, а теперь здесь должно стоять яланчынын дâ шââтӱ';
    const dictionaryEntry = {
      word: 'яначчынын дâ шââтӱ',
      translation: 'подтверждение правильности слов',
      partOfSpeech: 'словосочетание',
    };
    dictionaryService.findRelevantForPrompt.mockResolvedValueOnce([
      dictionaryEntry,
    ]);
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'update_words',
      entries: [
        {
          oldWord: 'яначчынын дâ шââтӱ',
          newWord: 'яланчынын дâ шââтӱ',
          translation: null,
        },
      ],
    } as any);

    await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

    expect(openaiService.normalizeDictionaryEntries).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.findRelevantForPrompt).toHaveBeenCalledWith(
      [text],
      30,
    );
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      text,
      [],
      [],
      [dictionaryEntry],
      { forceAction: true },
    );
    expect(dictionaryService.updateWord).toHaveBeenCalledWith({
      oldWord: 'яначчынын дâ шââтӱ',
      newWord: 'яланчынын дâ шââтӱ',
      translation: null,
      partOfSpeech: undefined,
      updatedBy: 'AAlxnv',
    });
  });

  it('falls back to AI when a locally parsed old word is not found', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    const text =
      'Баласи, исправь термин яначчынын дâ шââтӱ на яланчынын дâ шââтӱ';
    const dictionaryEntry = {
      word: 'яначчынын дâ шââтӱ',
      translation: 'подтверждение правильности слов',
      partOfSpeech: 'словосочетание',
    };
    dictionaryService.updateWord.mockResolvedValueOnce({
      status: 'not_found',
      requestedOldWord: 'термин яначчынын дâ шââтӱ',
    } as any);
    dictionaryService.findRelevantForPrompt.mockResolvedValueOnce([
      dictionaryEntry,
    ]);
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'update_words',
      entries: [
        {
          oldWord: 'яначчынын дâ шââтӱ',
          newWord: 'яланчынын дâ шââтӱ',
          translation: null,
        },
      ],
    } as any);

    await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

    expect(dictionaryService.updateWord).toHaveBeenNthCalledWith(1, {
      oldWord: 'термин яначчынын дâ шââтӱ',
      newWord: 'яланчынын дâ шââтӱ',
      translation: null,
      partOfSpeech: undefined,
      updatedBy: 'AAlxnv',
    });
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      text,
      [],
      [],
      [dictionaryEntry],
      { forceAction: true },
    );
    expect(dictionaryService.updateWord).toHaveBeenNthCalledWith(2, {
      oldWord: 'яначчынын дâ шââтӱ',
      newWord: 'яланчынын дâ шââтӱ',
      translation: null,
      partOfSpeech: undefined,
      updatedBy: 'AAlxnv',
    });
    expect(ctx.reply).not.toHaveBeenCalledWith(
      expect.stringContaining('не нашёл в словаре'),
      expect.anything(),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ поправил:'),
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('lets the AI fallback ask for clarification instead of guessing', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    const text =
      'Баласи, можешь исправить ошибку в словарной записи, пожалуйста?';
    openaiService.processBotMention.mockResolvedValueOnce({
      action: 'reply',
      message: 'Напишите, пожалуйста, старое и правильное новое значение.',
    });

    await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      text,
      [],
      [],
      [],
      { forceAction: true },
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      'Напишите, пожалуйста, старое и правильное новое значение.',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('adds a correction-like word pair that starts with топ instead of showing leaders', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
    (ctx.from as any).username = undefined;

    await (update as any).handleBotMention(
      ctx,
      'Бот, исправь топ фысалди - мяч сдулся',
      'anonymous',
      123,
      null,
    );

    expect(dictionaryService.getLeaderboard).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.upsertWord).toHaveBeenCalledWith({
      word: 'топ фысалди',
      translation: 'мяч сдулся',
      partOfSpeech: null,
      addedBy: 'anonymous',
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ записал:'),
      {
        reply_parameters: { message_id: 123 },
      },
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
