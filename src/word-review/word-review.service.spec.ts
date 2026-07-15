import { WordReviewService } from './word-review.service';

describe('WordReviewService interactive batches', () => {
  const makeRepo = () => ({
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => value),
    findOne: jest.fn(),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    update: jest.fn(async () => ({ affected: 1 })),
    delete: jest.fn(async () => ({ affected: 1 })),
    clear: jest.fn(),
    createQueryBuilder: jest.fn(),
  });

  const makeService = () => {
    const bot = {
      telegram: {
        sendMessage: jest.fn(async () => ({ message_id: 777 })),
        editMessageText: jest.fn(async () => ({})),
      },
    };
    const dictionary = { updateWord: jest.fn() };
    const configRepo = makeRepo();
    const historyRepo = makeRepo();
    const batchRepo = makeRepo();
    const itemRepo = makeRepo();
    const voteRepo = makeRepo();
    const correctionRepo = makeRepo();
    const wordRepo = makeRepo();
    const service = new WordReviewService(
      bot as any,
      dictionary as any,
      configRepo as any,
      historyRepo as any,
      batchRepo as any,
      itemRepo as any,
      voteRepo as any,
      correctionRepo as any,
      wordRepo as any,
    );
    return {
      service,
      bot,
      dictionary,
      configRepo,
      historyRepo,
      batchRepo,
      itemRepo,
      voteRepo,
      correctionRepo,
      wordRepo,
    };
  };

  const batch = {
    id: 10,
    chatId: -100,
    threadId: 44,
    messageId: 500,
    status: 'active',
    requiredVotes: 3,
    createdAt: new Date(),
    completedAt: null,
  };

  const item = {
    id: 20,
    batchId: 10,
    wordId: 30,
    position: 4,
    originalWord: 'агошка',
    originalTranslation: 'окно',
    proposedWord: 'агошка',
    proposedTranslation: 'окно',
    partOfSpeech: null,
    source: 'chat',
    status: 'voting',
    revision: 1,
    confirmedAt: null,
  };

  it('sends exactly ten words with only Верно and Исправить buttons', async () => {
    const {
      service,
      bot,
      configRepo,
      historyRepo,
      batchRepo,
      itemRepo,
      wordRepo,
    } = makeService();
    configRepo.find.mockResolvedValue([
      {
        id: 1,
        chatId: -100,
        threadId: 44,
        setBy: 'admin',
        setAt: new Date(),
      },
    ]);
    batchRepo.findOne.mockResolvedValue(null);
    batchRepo.save.mockImplementation(async (value) => ({
      ...value,
      id: value.id ?? 10,
    }));
    itemRepo.save.mockImplementation(async (values) =>
      Array.isArray(values)
        ? values.map((value, index) => ({ ...value, id: index + 1 }))
        : values,
    );
    historyRepo.find.mockResolvedValue([]);
    itemRepo.find.mockResolvedValue([]);
    const words = Array.from({ length: 10 }, (_, index) => ({
      id: index + 100,
      word: `слово ${index + 1}`,
      translation: `перевод ${index + 1}`,
      partOfSpeech: null,
      comments: null,
      source: 'chat',
      addedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => words),
    };
    wordRepo.createQueryBuilder.mockReturnValue(query);

    const result = await service.sendReviewBatch();

    expect(result).toEqual({ status: 'sent', count: 10, messageId: 777 });
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      -100,
      expect.stringContaining('Проверка словаря: 0 из 10'),
      expect.objectContaining({
        message_thread_id: 44,
        reply_markup: {
          inline_keyboard: expect.arrayContaining([
            [
              expect.objectContaining({ text: '1 ✅ Верно' }),
              expect.objectContaining({ text: '1 ✏️ Исправить' }),
            ],
          ]),
        },
      }),
    );
    const keyboard = (bot.telegram.sendMessage as jest.Mock).mock.calls[0][2]
      .reply_markup;
    expect(keyboard.inline_keyboard).toHaveLength(10);
    expect(
      keyboard.inline_keyboard
        .flat()
        .map((button) => button.text.replace(/^\d+\s+/, '')),
    ).toEqual(
      Array.from({ length: 10 }).flatMap(() => ['✅ Верно', '✏️ Исправить']),
    );
  });

  it('holds the item and asks for a reply after Исправить', async () => {
    const { service, bot, batchRepo, itemRepo, correctionRepo } = makeService();
    itemRepo.findOne.mockResolvedValue({ ...item });
    batchRepo.findOne.mockResolvedValue({ ...batch });
    correctionRepo.findOne.mockResolvedValue(null);
    jest
      .spyOn(service as any, 'refreshBatchMessage')
      .mockResolvedValue(undefined);

    const result = await service.handleAction({
      data: 'wr:fix:20:1',
      chatId: -100,
      userId: 7,
      username: 'tester',
      displayName: '@tester',
    });

    expect(result.message).toContain('правильный вариант');
    expect(itemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'awaiting_correction' }),
    );
    expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
      -100,
      expect.stringContaining('Сейчас: агошка — окно'),
      expect.objectContaining({ message_thread_id: 44 }),
    );
    expect(correctionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ promptMessageId: 777, revision: 1 }),
    );
  });

  it('replaces the word in the same package and resets its votes', async () => {
    const { service, batchRepo, itemRepo, voteRepo, correctionRepo } =
      makeService();
    correctionRepo.findOne.mockResolvedValue({
      id: 9,
      itemId: 20,
      chatId: -100,
      userId: 7,
      promptMessageId: 777,
      revision: 1,
      resolvedAt: null,
    });
    itemRepo.findOne.mockResolvedValue({
      ...item,
      status: 'awaiting_correction',
    });
    batchRepo.findOne.mockResolvedValue({ ...batch });
    jest
      .spyOn(service as any, 'refreshBatchMessage')
      .mockResolvedValue(undefined);

    const result = await service.handleCorrectionReply({
      chatId: -100,
      userId: 7,
      username: 'tester',
      replyToMessageId: 777,
      text: 'агошка — форточка',
    });

    expect(result.status).toBe('applied');
    expect(itemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        proposedWord: 'агошка',
        proposedTranslation: 'форточка',
        revision: 2,
        status: 'voting',
      }),
    );
    expect(voteRepo.delete).toHaveBeenCalledWith({ itemId: 20 });
    expect(correctionRepo.update).toHaveBeenCalled();
  });

  it('confirms on the third vote and immediately starts the next package', async () => {
    const {
      service,
      dictionary,
      batchRepo,
      itemRepo,
      voteRepo,
      correctionRepo,
    } = makeService();
    itemRepo.findOne.mockResolvedValue({ ...item });
    batchRepo.findOne.mockResolvedValue({ ...batch });
    voteRepo.findOne.mockResolvedValue(null);
    voteRepo.count.mockResolvedValue(3);
    itemRepo.count.mockResolvedValue(0);
    correctionRepo.update.mockResolvedValue({ affected: 0 });
    jest
      .spyOn(service as any, 'refreshBatchMessage')
      .mockResolvedValue(undefined);
    const nextBatch = jest
      .spyOn(service, 'sendReviewBatch')
      .mockResolvedValue({ status: 'sent', count: 10 });

    const result = await service.handleAction({
      data: 'wr:correct:20:1',
      chatId: -100,
      userId: 7,
      username: 'tester',
      displayName: '@tester',
    });

    expect(result.message).toBe('Слово подтверждено ✅');
    expect(itemRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed' }),
    );
    expect(dictionary.updateWord).not.toHaveBeenCalled();
    expect(batchRepo.update).toHaveBeenCalledWith(
      { id: 10, status: 'active' },
      expect.objectContaining({ status: 'completed' }),
    );
    expect(nextBatch).toHaveBeenCalledTimes(1);
  });
});
