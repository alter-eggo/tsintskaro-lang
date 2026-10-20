import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { DictionaryContentError } from '../dictionary/dictionary-content';
import { DictionaryRequest } from './entities/dictionary-request.entity';
import { numberedItems, requestContent } from './dictionary-request-content';
export {
  numberedItems,
  requestItems,
  requestText,
} from './dictionary-request-content';

export type RequestReceipt =
  | { type: 'notice'; text: string }
  | { type: 'process'; request: DictionaryRequest }
  /** Not part of a correction list; `reason` explains why for the bot journal. */
  | { type: 'ignored'; reason: string };

const ignored = (reason: string): RequestReceipt => ({
  type: 'ignored',
  reason,
});

/** «Готово…» and «Отмени список», with or without an address to the bot. */
export function listCommand(text: string) {
  const clean = text
    .replace(/^\s*(?:(?:баласи|бот)[\s,:!.—-]+|@\w+\s*)/i, '')
    .trim();
  return {
    clean,
    finish: clean.match(
      /^готово(?:[\s,:—-]+(\d+))?(?:[\s,]+только перечисленные(?: пункты)?)?[.!]?$/i,
    ),
    cancel: /^(?:отмени список|отмена списка)[.!]?$/i.test(clean),
  };
}

@Injectable()
export class DictionaryRequestService {
  constructor(
    @InjectRepository(DictionaryRequest)
    private readonly repo: Repository<DictionaryRequest>,
  ) {}

  private async locked<T>(
    scope: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.repo.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `dictionary-request:${scope}`,
      ]);
      return work(manager);
    });
  }

  async receive(input: {
    scope: string;
    messageId: number;
    text: string;
    addressed: boolean;
    replyToMessageId?: number;
    replyToBot?: boolean;
  }): Promise<RequestReceipt> {
    const { clean, finish, cancel } = listCommand(input.text);
    const start =
      input.addressed &&
      numberedItems(clean).length > 0 &&
      (/^(?:\d+[.)]\s)/.test(clean) ||
        /(?:исправ|коррект|внес|добав|измени|перенес|удали|словар|итог)/i.test(
          clean,
        ));
    const hasItems = numberedItems(clean).length > 0;
    // Ordinary conversation must never be captured just because a draft is open.
    if (!input.addressed && /^@\w+/.test(input.text.trim()))
      return ignored('сообщение адресовано участнику, а не боту');
    if (!input.addressed && !hasItems && !finish && !cancel)
      return ignored('нет обращения к боту');
    return this.locked(input.scope, async (manager) => {
      const repo = manager.getRepository(DictionaryRequest);
      const seen = await repo
        .createQueryBuilder('request')
        .where('request.scope = :scope', { scope: input.scope })
        .andWhere('request.parts @> CAST(:part AS jsonb)', {
          part: JSON.stringify([{ messageId: input.messageId }]),
        })
        .getOne();
      let request = await repo.findOne({
        where: { scope: input.scope },
        order: { id: 'DESC' },
      });
      if (
        !input.addressed &&
        input.replyToMessageId != null &&
        !(input.replyToBot && (finish || cancel)) &&
        !request?.parts.some(
          (part) => part.messageId === input.replyToMessageId,
        )
      )
        return ignored(
          `ответ на сообщение #${input.replyToMessageId}, которое не входит в список; без обращения к боту это обсуждение`,
        );
      if (seen)
        return {
          type: 'notice',
          text: 'Эта часть уже получена. Повторно ничего не меняю. Если список ещё не применён, напиши «Готово».',
        };
      if (
        !request ||
        request.status === 'applied' ||
        request.status === 'cancelled'
      ) {
        if (!start)
          return finish && request
            ? {
                type: 'notice',
                text:
                  request.status === 'applied'
                    ? 'Этот список уже сохранён. Повторно ничего не меняю.'
                    : 'Этот список отменён. Пришли новый список исправлений.',
              }
            : ignored(
                finish || cancel
                  ? 'открытого списка исправлений нет'
                  : input.addressed
                    ? 'не список исправлений'
                    : 'нумерованный текст без обращения к боту не начинает список',
              );
        request = repo.create({
          scope: input.scope,
          firstMessageId: input.messageId,
          parts: [],
          revision: 0,
          status: 'collecting',
          question: null,
        });
      }
      if (cancel) {
        request.status = 'cancelled';
        request.revision++;
        await repo.save(request);
        return {
          type: 'notice',
          text: 'Список отменён. Словарь не изменён; полученный текст сохранён в истории.',
        };
      }
      if (finish) {
        const content = requestContent(request);
        const items = content.items;
        if (!items.length)
          return {
            type: 'notice',
            text: 'В черновике только обсуждение без обращения ко мне. Словарь не изменён.',
          };
        if (content.conflicts.length)
          return {
            type: 'notice',
            text: `Разные варианты пунктов: ${content.conflicts.join(', ')}. Уточни только эти пункты, обратившись ко мне, затем напиши «Готово». Остальной список сохранён, повторять его не нужно.`,
          };
        const unique = new Set(items);
        const missing: number[] = [];
        const last = Math.max(0, ...items);
        // Only inspect the received range, without allocating from an untrusted large number.
        const sorted = [...unique].sort((a, b) => a - b);
        const hasGap = sorted.some(
          (item, index) => index > 0 && item !== sorted[index - 1] + 1,
        );
        if (hasGap)
          for (
            let index = 1;
            index < sorted.length && missing.length < 10;
            index++
          ) {
            for (
              let n = sorted[index - 1] + 1;
              n < sorted[index] && missing.length < 10;
              n++
            )
              missing.push(n);
          }
        const expected = finish[1];
        if (
          items.some((item) => !Number.isSafeInteger(item) || item < 1) ||
          (hasGap && !/только перечисленные/i.test(clean)) ||
          (expected && Number(expected) !== items.length)
        ) {
          return {
            type: 'notice',
            text: `Список пока не применён. Получено ${items.length} пунктов (до №${last}). ${missing.length ? `Не хватает номеров: ${missing.join(', ')}. Пришли только недостающие пункты. Если пропуски намеренные, напиши «Готово, только перечисленные пункты».` : 'Проверь количество и номера пунктов.'} Полученные пункты сохранены, повторять весь список не нужно.`,
          };
        }
        request.status = 'ready';
        await repo.save(request);
        return { type: 'process', request };
      }
      const clarification =
        request.status === 'ready' && input.addressed && !hasItems;
      if (!hasItems && !clarification)
        return ignored('в сообщении нет нумерованных пунктов для списка');
      request.parts.push({
        messageId: input.messageId,
        text: input.text,
        addressed: input.addressed,
        ...(clarification ? { clarification: true } : {}),
      });
      request.parts.sort((a, b) => a.messageId - b.messageId);
      request.firstMessageId = Math.min(
        Number(request.firstMessageId),
        input.messageId,
      );
      request.revision++;
      if (!clarification) request.status = 'collecting';
      await repo.save(request);
      if (clarification) return { type: 'process', request };
      const content = requestContent(request);
      return {
        type: 'notice',
        text: `Получено частей: ${content.partCount}, пунктов: ${content.items.length}. Словарь пока не изменён. Пришли продолжение, затем «Готово» (можно «Готово 100» для проверки количества).`,
      };
    });
  }

  /** Collecting or awaiting-clarification lists whose scope starts with `prefix`. */
  async openDrafts(prefix: string): Promise<DictionaryRequest[]> {
    const rows = await this.repo.find({
      where: { status: In(['collecting', 'ready']) },
      order: { id: 'DESC' },
    });
    return rows.filter((row) => row.scope.startsWith(prefix));
  }

  async rememberQuestion(
    request: DictionaryRequest,
    question: string,
  ): Promise<void> {
    await this.repo.update(
      { id: request.id, revision: request.revision, status: 'ready' },
      { question },
    );
  }

  async commit<T>(
    request: DictionaryRequest,
    apply: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.locked(request.scope, async (manager) => {
      const repo = manager.getRepository(DictionaryRequest);
      const current = await repo.findOneBy({ id: request.id });
      if (current?.status === 'applied')
        throw new DictionaryContentError(
          'Этот список уже сохранён. Повторно ничего не меняю.',
        );
      if (
        !current ||
        current.revision !== request.revision ||
        current.status !== 'ready'
      )
        throw new DictionaryContentError(
          'Список дополнился или отменён во время проверки. Ничего не сохранено; проверь состав и напиши «Готово».',
        );
      const result = await apply(manager);
      current.status = 'applied';
      await repo.save(current);
      return result;
    });
  }
}
