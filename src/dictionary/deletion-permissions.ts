const WORD_DELETION_EDITORS = new Set(['elvardi']);

export const WORD_DELETION_DENIED =
  'Удалять слова из словаря могут только администраторы и @Elvardi.';

/** This grants dictionary deletion only, not Telegram administrator rights. */
export function hasWordDeletionGrant(
  username: string | null | undefined,
): boolean {
  return (
    typeof username === 'string' &&
    WORD_DELETION_EDITORS.has(username.toLowerCase())
  );
}
