import { IsNull } from 'typeorm';
import { TelegramService } from './telegram.service';

describe('TelegramService default memory', () => {
  it('adds the Tsintskaro noun plural rule to global bot memory', async () => {
    const botMemoryRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    const service = new TelegramService(
      {} as any,
      {} as any,
      {} as any,
      botMemoryRepo as any,
    );

    await service.ensureDefaultGlobalMemory();

    expect(botMemoryRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 0,
        memoryKey: 'tsintskaro-noun-plural-rule',
        active: true,
        text: expect.stringContaining(
          'После мягких гласных основы â, e, и, û, ô, ŷ используется аффикс -лâр',
        ),
      }),
    );
  });
});

describe('TelegramService conversation context', () => {
  const makeService = () => {
    const repo = {
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn((row) => row),
      save: jest.fn(async (row) => row),
    };
    return {
      repo,
      service: new TelegramService(
        repo as any,
        {} as any,
        {} as any,
        {} as any,
      ),
    };
  };

  it.each([null, 42])(
    'keeps history inside its topic and excludes cleared messages: %s',
    async (threadId) => {
      const { service, repo } = makeService();
      await service.getRecentMessages(-100, threadId, 50);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            chatId: -100,
            threadId: threadId ?? IsNull(),
            clearedAt: IsNull(),
          },
          take: 50,
          order: { sentAt: 'DESC', id: 'DESC' },
        }),
      );
    },
  );

  it('keeps bot conversations out of report extraction and message thresholds', async () => {
    const { service, repo } = makeService();
    await service.saveContextMessage({
      chatId: -100,
      threadId: 42,
      telegramMessageId: 123,
      username: 'Баласи',
      text: 'Âв — дом.',
      sentAt: new Date(),
      isBot: true,
    });
    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ contextOnly: true, isBot: true }),
    );
    expect(repo.count).not.toHaveBeenCalled();
    await service.getActiveMessages(-100);
    await service.getCount(-100);
    const where = {
      chatId: -100,
      contextOnly: false,
      reportId: IsNull(),
      clearedAt: IsNull(),
    };
    expect(repo.find).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(repo.count).toHaveBeenCalledWith({ where });
  });
});
