const DRAFT_MANAGERS = new Set(['aalxnv']);

/**
 * May finish, cancel or extend another author's correction list. The caller
 * must supply the current sender's Telegram username, never message text.
 */
export function canManageOthersDrafts(
  username: string | null | undefined,
): boolean {
  return (
    typeof username === 'string' && DRAFT_MANAGERS.has(username.toLowerCase())
  );
}
