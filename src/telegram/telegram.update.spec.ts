import { TelegramUpdate } from './telegram.update';

describe('TelegramUpdate bot mentions', () => {
  const makeUpdate = () => {
    const dictionaryService = {
      upsertWord: jest.fn(async (input) => ({
        created: true,
        translationAdded: true,
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
    };
    const telegramService = {
      getRecentMessages: jest.fn(async () => []),
      getBotMemory: jest.fn(async () => []),
      ensureDefaultGlobalMemory: jest.fn(),
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
      reply: jest.fn(),
      replyWithPhoto: jest.fn(),
      telegram: { setMessageReaction: jest.fn() },
    };

    const update = new TelegramUpdate(
      { telegram: { setMyCommands: jest.fn() } } as any,
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
    expect(openaiService.processBotMention).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith('сахгкал оти — укроп (сущ.)', {
      reply_parameters: { message_id: 123 },
    });
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
