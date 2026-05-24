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
      getLeaderboard: jest.fn(async () => [
        { username: 'anonymous', wordsCount: 410 },
      ]),
    };
    const openaiService = {
      processBotMention: jest.fn(async () => ({
        action: 'reply',
        message: 'ok',
      })),
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
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('✅ записал (34):'),
      { reply_parameters: { message_id: 123 } },
    );
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
