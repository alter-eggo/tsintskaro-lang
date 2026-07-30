import { TelegramUpdate } from './telegram.update';

describe('TelegramUpdate bot mentions', () => {
  const makeUpdate = () => {
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
      getStatus: jest.fn(async () => ({
        target: null,
        totalChatWords: 0,
        sentWordCount: 0,
        remainingWordCount: 0,
        lastSentAt: null,
        activeBatch: null,
      })),
      sendReviewBatch: jest.fn(async () => ({ status: 'sent', count: 10 })),
      handleAction: jest.fn(async () => ({
        status: 'handled',
        message: 'Голос учтён.',
      })),
      handleCorrectionReply: jest.fn(async () => ({
        status: 'not_correction',
      })),
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
    const ctx = {
      chat: { id: -100, type: 'supergroup' },
      message: {},
      from: { username: 'AAlxnv' },
      reply: jest.fn(),
      replyWithPhoto: jest.fn(),
      telegram: { setMessageReaction: jest.fn() },
    };
    const bot = {
      telegram: {
        setMyCommands: jest.fn(),
        sendMessage: jest.fn(async () => undefined),
      },
    };

    const update = new TelegramUpdate(
      bot as any,
      telegramService as any,
      openaiService as any,
      dictionaryService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      wordReviewService as any,
      openaiUsageService as any,
      { get: jest.fn(() => 100) } as any,
    );

    return {
      update,
      ctx,
      dictionaryService,
      openaiService,
      telegramService,
      wordReviewService,
      bot,
    };
  };

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

  it('still replies with the leaderboard for an explicit leaderboard request', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, покажи топ добавивших слова',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.getLeaderboard).toHaveBeenCalledTimes(1);
    expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      '🏆 Топ добавивших слова:\n1. @anonymous — 410 слов',
      { reply_parameters: { message_id: 123 } },
    );
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
      expect.stringContaining('Проверка словаря будет приходить сюда'),
      { parse_mode: 'HTML' },
    );

    (ctx.reply as jest.Mock).mockClear();
    (ctx as any).message = { text: '/reviewnow 10' };
    await update.onReviewNow(ctx as any);

    expect(wordReviewService.sendReviewBatch).toHaveBeenCalledWith();
    expect(ctx.reply).toHaveBeenCalledWith('✅ Отправил 10 слов на проверку.');
  });

  it('answers a direct dictionary lookup locally without OpenAI', async () => {
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      'Нашёл в словаре:\n\nСлово: сахгкал оти\nПеревод: укроп\nЧасть речи: сущ.',
      {
        reply_parameters: { message_id: 123 },
      },
    );
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      'Нашёл в словаре:\n\n' +
        'Слово: салам\n' +
        'Перевод: привет\n' +
        'Часть речи: междометие',
      { reply_parameters: { message_id: 123 } },
    );
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      'Нашёл в словаре:\n\n' +
        'Слово: чâсич\n' +
        'Перевод: порез\n' +
        'Часть речи: не указана\n' +
        'Источник: добавлено участниками чата',
      { reply_parameters: { message_id: 123 } },
    );
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
  });

  it('explains that both dictionary directions were checked when no match exists', async () => {
    const { update, ctx, dictionaryService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Бот, как перевести слово привет?',
      'AAlxnv',
      123,
      null,
    );

    expect(dictionaryService.findWord).toHaveBeenCalledWith('привет');
    expect(dictionaryService.findByTranslation).toHaveBeenCalledWith('привет');
    expect(ctx.reply).toHaveBeenCalledWith(
      'Проверил «привет» среди цинцкарских слов и русских переводов: ' +
        'в нашем словаре точного совпадения пока нет. ' +
        'Проверь написание или добавь это значение в словарь.',
      { reply_parameters: { message_id: 123 } },
    );
  });

  it('understands an explicit translation direction after the word', async () => {
    const { update, ctx, dictionaryService } = makeUpdate();
    dictionaryService.findByTranslation.mockResolvedValueOnce([
      {
        word: 'салам',
        translation: 'привет',
        partOfSpeech: 'междометие',
      },
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      'Да, нашёл в словаре запись для «урожай»:\n\nСлово: махсыл\nПеревод: урожай\nЧасть речи: существительное\nИсточник: эталонный словарь\nПримечание: Общее название собранного урожая.',
      { reply_parameters: { message_id: 123 } },
    );
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
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();
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
      updatedBy: 'AAlxnv',
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
      const { update, ctx, dictionaryService, openaiService } = makeUpdate();

      await (update as any).handleBotMention(ctx, text, 'AAlxnv', 123, null);

      expect(dictionaryService.upsertWord).not.toHaveBeenCalled();
      expect(openaiService.processBotMention).not.toHaveBeenCalled();
      expect(dictionaryService.updateWord).toHaveBeenCalledWith({
        oldWord,
        newWord,
        translation,
        partOfSpeech: undefined,
        updatedBy: 'AAlxnv',
      });
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('✅ поправил:'),
        { reply_parameters: { message_id: 123 } },
      );
    },
  );

  it('understands a natural command that only changes a translation', async () => {
    const { update, ctx, dictionaryService, openaiService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, исправьте перевод словосочетания яланчынын дâ шââтӱ на подтверждение правильности слов',
      'AAlxnv',
      123,
      null,
    );

    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(dictionaryService.updateWord).toHaveBeenCalledWith({
      oldWord: 'яланчынын дâ шââтӱ',
      newWord: null,
      translation: 'подтверждение правильности слов',
      partOfSpeech: undefined,
      updatedBy: 'AAlxnv',
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
      5,
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

  it('does not load chat history or memory for an ordinary AI question', async () => {
    const { update, ctx, openaiService, telegramService } = makeUpdate();

    await (update as any).handleBotMention(
      ctx,
      'Баласи, помоги красиво сформулировать объявление',
      'AAlxnv',
      123,
      null,
    );

    expect(telegramService.getRecentMessages).not.toHaveBeenCalled();
    expect(telegramService.getBotMemory).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, помоги красиво сформулировать объявление',
      [],
      [],
      [],
    );
  });

  it('loads recent messages only for a conversation summary request', async () => {
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
    expect(telegramService.getBotMemory).not.toHaveBeenCalled();
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, о чём говорили в последних сообщениях?',
      recentMessages,
      [],
      [],
    );
  });

  it('loads memory without chat history for a community context question', async () => {
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

    expect(telegramService.getRecentMessages).not.toHaveBeenCalled();
    expect(telegramService.getBotMemory).toHaveBeenCalledWith(-100, 50);
    expect(openaiService.processBotMention).toHaveBeenCalledWith(
      'Баласи, что известно о встрече Общества Цинцкаро?',
      [],
      memory,
      [],
    );
  });
});
