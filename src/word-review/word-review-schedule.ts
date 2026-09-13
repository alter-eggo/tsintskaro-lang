export const WORD_REVIEW_TIME_ZONE = 'Asia/Tbilisi';
export const WORD_REVIEW_INTERVAL_DAYS = 3;
export const WORD_REVIEW_SCHEDULE_LABEL = 'каждые 3 дня в 09:00 по Тбилиси';

/** Tbilisi calendar date, independent of the server's local time zone. */
export function reviewCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: WORD_REVIEW_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function nextReviewDate(anchor: Date, now: Date): Date {
  // Asia/Tbilisi uses UTC+04:00. The initial delivery may happen at any hour;
  // every subsequent delivery is at 09:00 on the anchored three-day cycle.
  const next = new Date(`${reviewCalendarDate(anchor)}T09:00:00+04:00`);
  do {
    next.setUTCDate(next.getUTCDate() + WORD_REVIEW_INTERVAL_DAYS);
  } while (next <= now);
  return next;
}

export function formatReviewDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: WORD_REVIEW_TIME_ZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
