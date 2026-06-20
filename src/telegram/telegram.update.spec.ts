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
    const ctx = {
      chat: { id: -100, type: 'supergroup' },
      reply: jest.fn(),
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
      { get: jest.fn(() => 100) } as any,
    );

    return { update, ctx, dictionaryService, openaiService };
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
});
