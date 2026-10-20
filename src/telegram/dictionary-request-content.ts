import {
  DictionaryRequest,
  DictionaryRequestPart,
} from './entities/dictionary-request.entity';

const ADDRESS = /^\s*(?:(?:баласи|бот)[\s,:!.—-]+|@\w+[\s,:!.—-]*)/i;

function splitItems(text: string) {
  const clean = text.replace(ADDRESS, '');
  const offset = text.length - clean.length;
  const matches = [...clean.matchAll(/^[ \t]*(\d+)[.)]\s+\S/gm)];
  return {
    heading: matches.length ? text.slice(0, offset + matches[0].index) : '',
    items: matches.map((match, index) => ({
      number: Number(match[1]),
      text: text
        .slice(
          offset + match.index,
          index + 1 < matches.length
            ? offset + matches[index + 1].index
            : undefined,
        )
        .trimEnd(),
    })),
  };
}

/**
 * Review batches render items as «N. запись — перевод», so the text before the
 * first « — » names the existing record exactly, even a malformed one.
 */
export function itemRecordNames(
  text: string,
): { item: number; word: string }[] {
  return [
    ...text.matchAll(/^[ \t]*(\d+)[.)][ \t]+([^\n]+?)[ \t]+—[ \t]/gm),
  ].map((match) => ({ item: Number(match[1]), word: match[2] }));
}

export function numberedItems(text: string): number[] {
  return splitItems(text).items.map((item) => item.number);
}

function explicitlyAddressed(part: DictionaryRequestPart): boolean {
  // Old drafts have no addressing metadata. Only recover an unmistakable
  // address to this bot; an arbitrary @username may belong to another person.
  return part.addressed ?? /^\s*(?:баласи|бот)[\s,:!.—-]+/i.test(part.text);
}

export function requestContent(request: DictionaryRequest) {
  const parsed = [...request.parts]
    .sort((a, b) => a.messageId - b.messageId)
    .map((part) => ({ part, ...splitItems(part.text) }));
  const start = parsed.findIndex(
    ({ part, items }) =>
      !part.clarification && explicitlyAddressed(part) && items.length > 0,
  );
  const parts = start < 0 ? [] : parsed.slice(start);
  const selected = new Map<
    number,
    { text: string; normalized: string; partIndex: number }
  >();
  const conflicts = new Set<number>();
  for (const [partIndex, { part, items }] of parts.entries()) {
    if (part.clarification) continue;
    for (const item of items) {
      const normalized = item.text.normalize('NFC').replace(/\s+/g, ' ').trim();
      const previous = selected.get(item.number);
      const correction =
        previous &&
        previous.partIndex !== partIndex &&
        explicitlyAddressed(part);
      if (previous && !correction) {
        if (previous.normalized !== normalized) conflicts.add(item.number);
        continue;
      }
      selected.set(item.number, { text: item.text, normalized, partIndex });
      conflicts.delete(item.number);
    }
  }

  const rendered = parts.flatMap(({ part, heading }, partIndex) => {
    if (part.clarification) return [`\nУточнение редактора:\n${part.text}`];
    const items = [...selected.values()].filter(
      (item) => item.partIndex === partIndex,
    );
    return items.length
      ? [`${heading}${items.map((item) => item.text).join('\n')}`]
      : [];
  });
  return {
    text: rendered.join('\n'),
    items: [...selected.keys()].sort((a, b) => a - b),
    conflicts: [...conflicts].sort((a, b) => a - b),
    partCount: rendered.length,
  };
}

export function requestText(request: DictionaryRequest): string {
  return requestContent(request).text;
}

export function requestItems(request: DictionaryRequest): number[] {
  return requestContent(request).items;
}
