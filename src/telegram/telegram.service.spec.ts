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
