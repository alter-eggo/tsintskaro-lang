const TRANSLATION_EDITORS = new Set(['joanofarc74', 'ekaterina_karaasheva']);

export const TRANSLATION_EDIT_DENIED =
  'Изменять переводы существующих слов могут только @joanofarc74 и @ekaterina_karaasheva.';

/** The caller must supply the current sender's Telegram username, never message text. */
export function canEditTranslations(
  username: string | null | undefined,
): boolean {
  return (
    typeof username === 'string' &&
    TRANSLATION_EDITORS.has(username.toLowerCase())
  );
}

export class TranslationEditForbiddenError extends Error {
  constructor() {
    super(TRANSLATION_EDIT_DENIED);
  }
}

export function assertCanEditTranslations(
  username: string | null | undefined,
): void {
  if (!canEditTranslations(username)) throw new TranslationEditForbiddenError();
}
