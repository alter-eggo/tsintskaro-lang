export type ReviewWordReference = { position: number } | { word: string };

export interface ReviewDecisionRequest {
  batchId?: number;
  mode: 'all' | 'all_except' | 'confirm' | 'dispute';
  words: ReviewWordReference[];
}

export const REVIEW_DECISION_HELP =
  'Укажите итог явно:\n' +
  '«Баласи, партия №5 разобрана»\n' +
  '«Баласи, партия №5 разобрана, кроме слов 3 и 7»\n' +
  '«Баласи, в партии №5 разобраны слова 1, 2 и 4»\n' +
  '«Баласи, в партии №5 слово ширин разобрано».\n' +
  'В ответе на список бота номер партии можно не указывать.';

export function normalizeReviewWord(word: string): string {
  return word.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function references(text: string): ReviewWordReference[] | null {
  const token =
    /\s*(?:«([^»]+)»|"([^"]+)"|`([^`]+)`|([^,;]+?))\s*(?:[,;]|\s+и\s+|$)/gy;
  const words: ReviewWordReference[] = [];
  let offset = 0;
  while (offset < text.length) {
    const match = token.exec(text);
    if (!match || token.lastIndex <= offset) return null;
    offset = token.lastIndex;
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4]).trim();
    const number = /^(?:№\s*)?(\d+)$/.exec(value);
    if (number) {
      const position = Number(number[1]);
      if (!Number.isSafeInteger(position) || position < 1 || position > 100)
        return null;
      words.push({ position });
    } else {
      if (!value || !/^[\p{L}\p{M}\s'’\-]+$/u.test(value)) return null;
      words.push({ word: normalizeReviewWord(value) });
    }
  }
  return words.length && words.length <= 100 ? words : null;
}

/** Only complete, explicit statements can change review status. No AI inference. */
export function parseReviewDecision(
  text: string,
): ReviewDecisionRequest | 'invalid' | null {
  let body = text
    .trim()
    .replace(/^(?:баласи|бот)(?:[\s,:!.—-]+)|^@\w+[\s,:!.—-]+/i, '')
    .replace(/^пожалуйста[,\s]+/i, '')
    .trim();
  // Leave translation edits and other bot actions to their own handlers.
  if (/^(?:замени|исправь|добавь|поменяй|удали|запомни)/i.test(body))
    return null;
  if (
    !/(?:партия|партии|слово|слова)/i.test(body) ||
    !/(?:разобран|проверен|спорн)/i.test(body)
  )
    return null;
  if (/[?]/.test(body)) return 'invalid';
  const outsideQuotes = body.replace(/«[^»]*»|"[^"]*"|`[^`]*`/g, '');
  if (
    /(?:^|\s)(?:не|ещ[её]|кажется|вроде|возможно)(?=\s|[,.!]|$)/i.test(
      outsideQuotes,
    )
  )
    return 'invalid';
  body = body.replace(/[.!]+$/, '').trim();

  let batchId: number | undefined;
  const batch = /^(?:в\s+)?партии\s+(?:№\s*)?(\d+)\s*[:,]?\s*/i.exec(body);
  if (batch) {
    batchId = Number(batch[1]);
    body = body.slice(batch[0].length);
  }
  const all =
    /^партия(?:\s+(?:№\s*)?(\d+))?\s+(?:полностью\s+)?(?:разобрана|проверена)([\s\S]*)$/i.exec(
      body,
    );
  if (all) {
    if (batchId != null) return 'invalid';
    batchId = all[1] ? Number(all[1]) : undefined;
    const tail = all[2].trim();
    if (!tail) return valid({ batchId, mode: 'all', words: [] });
    const except = /^(?:[,;]\s*)?кроме\s+(.+)$/i.exec(tail);
    const exceptionWords = except
      ? except[1].replace(/^слова?(?:\s+|$)/i, '')
      : /^[.;]\s*слов[ао]\s+(.+?)\s+(?:пока\s+)?(?:спорные|спорное)$/i.exec(
          tail,
        )?.[1];
    const words = exceptionWords && references(exceptionWords);
    return words ? valid({ batchId, mode: 'all_except', words }) : 'invalid';
  }

  const selected =
    /^(?:разобраны|разобрано|проверены|проверено)\s+слов[ао]\s+(.+)$/i.exec(
      body,
    ) ??
    /^слов[ао]\s+(.+?)\s+(?:разобраны|разобрано|проверены|проверено)$/i.exec(
      body,
    );
  const disputed = /^слов[ао]\s+(.+?)\s+(?:пока\s+)?(?:спорные|спорное)$/i.exec(
    body,
  );
  const words =
    (selected || disputed) && references((selected || disputed)![1]);
  return words
    ? valid({ batchId, mode: disputed ? 'dispute' : 'confirm', words })
    : 'invalid';
}

function valid(
  request: ReviewDecisionRequest,
): ReviewDecisionRequest | 'invalid' {
  return request.batchId != null &&
    (!Number.isSafeInteger(request.batchId) || request.batchId < 1)
    ? 'invalid'
    : request;
}

export class WordReviewDecisionError extends Error {}
