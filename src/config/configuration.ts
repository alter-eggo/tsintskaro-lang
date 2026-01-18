export default () => ({
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  openaiKey: process.env.OPENAI_API_KEY,
  messageThreshold: parseInt(process.env.MESSAGE_THRESHOLD, 10) || 100,
});
