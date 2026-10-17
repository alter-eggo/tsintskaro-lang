import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { DictionaryContentError } from '../dictionary/dictionary-content';
import { DictionaryRequest } from './entities/dictionary-request.entity';

export function numberedItems(text: string): number[] {
  const clean = text.replace(/^\s*(?:(?:баласи|бот)[\s,:!.—-]+|@\w+\s*)/i, '');
  return [...clean.matchAll(/^[ \t]*(\d+)[.)]\s+\S/gm)].map((match) =>
    Number(match[1]),
  );
}

export function requestText(request: DictionaryRequest): string {
  return request.parts
    .map(
      (part) =>
        `${part.clarification ? '\nУточнение редактора:\n' : ''}${part.text}`,
    )
    .join('\n');
}

export function requestItems(request: DictionaryRequest): number[] {
  return numberedItems(
    request.parts
      .filter((part) => !part.clarification)
      .map((part) => part.text)
      .join('\n'),
  );
}

export type RequestReceipt =
  | { type: 'notice'; text: string }
  | { type: 'process'; request: DictionaryRequest };

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
  }): Promise<RequestReceipt | null> {
    const clean = input.text
      .replace(/^\s*(?:(?:баласи|бот)[\s,:!.—-]+|@\w+\s*)/i, '')
      .trim();
    const start =
      input.addressed &&
      numberedItems(clean).length > 0 &&
      (/^(?:\d+[.)]\s)/.test(clean) ||
        /(?:исправ|коррект|внес|добав|измени|перенес|удали|словар|итог)/i.test(
          clean,
        ));
    const finish = clean.match(
      /^готово(?:[\s,:—-]+(\d+))?(?:[\s,]+только перечисленные(?: пункты)?)?[.!]?$/i,
    );
    const cancel = /^(?:отмени список|отмена списка)[.!]?$/i.test(clean);
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
            : null;
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
        const items = requestItems(request);
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
          unique.size !== items.length ||
          (hasGap && !/только перечисленные/i.test(clean)) ||
          (expected && Number(expected) !== items.length)
        ) {
          return {
            type: 'notice',
            text: `Список пока не применён. Получено ${items.length} пунктов (до №${last}). ${unique.size !== items.length ? 'Есть повторяющиеся номера.' : missing.length ? `Не хватает номеров: ${missing.join(', ')}. Если пропуски намеренные, напиши «Готово, только перечисленные пункты».` : 'Проверь количество и номера пунктов.'} Пришли недостающую часть или отмени список и отправь исправленный.`,
          };
        }
        request.status = 'ready';
        await repo.save(request);
        return { type: 'process', request };
      }
      if (
        request.status === 'ready' &&
        !input.addressed &&
        !numberedItems(clean).length
      )
        return null;
      const clarification =
        request.status === 'ready' && !numberedItems(clean).length;
      request.parts.push({
        messageId: input.messageId,
        text: input.text,
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
      return {
        type: 'notice',
        text: `Получено частей: ${request.parts.length}, пунктов: ${requestItems(request).length}. Словарь пока не изменён. Пришли продолжение, затем «Готово» (можно «Готово 100» для проверки количества). Для отмены — «Отмени список».`,
      };
    });
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
