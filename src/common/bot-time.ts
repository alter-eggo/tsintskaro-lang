export const BOT_TIME_ZONE = 'Europe/Moscow';
export const BOT_TIME_ZONE_LABEL = 'МСК';

export const BOT_TIME_INSTRUCTION =
  `Все даты и время в ответах указывай по московскому времени (${BOT_TIME_ZONE}, ${BOT_TIME_ZONE_LABEL}), с пометкой «${BOT_TIME_ZONE_LABEL}». ` +
  'Если во входных данных явно указан другой часовой пояс, переводи время в московское с учётом смены даты. Не угадывай часовой пояс, если он неизвестен.';

export function formatBotDate(date: Date): string {
  return `${new Intl.DateTimeFormat('ru-RU', {
    timeZone: BOT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)} ${BOT_TIME_ZONE_LABEL}`;
}

export function formatBotDateTime(
  date: Date,
  timeZone = BOT_TIME_ZONE,
): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const label = timeZone === BOT_TIME_ZONE ? BOT_TIME_ZONE_LABEL : timeZone;
  return `${formatted} ${label}`;
}
