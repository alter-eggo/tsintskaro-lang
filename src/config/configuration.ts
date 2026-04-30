export default () => {
  const isDev = process.env.NODE_ENV !== 'production';
  const pollEnableInDev = process.env.POLL_ENABLE_IN_DEV === 'true';

  return {
    isDev,
    pollEnableInDev,
    telegramToken: isDev
      ? process.env.TELEGRAM_BOT_TOKEN_DEV
      : process.env.TELEGRAM_BOT_TOKEN,
    openaiKey: process.env.OPENAI_API_KEY,
    messageThreshold: parseInt(process.env.MESSAGE_THRESHOLD, 10) || 100,
    databaseUrl: process.env.DATABASE_URL,
  };
};
