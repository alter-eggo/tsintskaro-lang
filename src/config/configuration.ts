export default () => {
  const isDev = process.env.NODE_ENV !== 'production';
  const pollEnableInDev = process.env.POLL_ENABLE_IN_DEV === 'true';
  const factDayEnableInDev = process.env.FACT_DAY_ENABLE_IN_DEV === 'true';
  const wordReviewEnableInDev =
    process.env.WORD_REVIEW_ENABLE_IN_DEV === 'true';
  const openaiUsageReportEnableInDev =
    process.env.OPENAI_USAGE_REPORT_ENABLE_IN_DEV === 'true';
  const openaiUsageReportChatId = process.env.OPENAI_USAGE_REPORT_CHAT_ID
    ? Number(process.env.OPENAI_USAGE_REPORT_CHAT_ID)
    : null;
  const openaiUsageReportThreadId = process.env.OPENAI_USAGE_REPORT_THREAD_ID
    ? Number(process.env.OPENAI_USAGE_REPORT_THREAD_ID)
    : null;
  const positiveInt = (value: string | undefined, fallback: number) => {
    const parsed = value ? Number(value) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    isDev,
    pollEnableInDev,
    factDayEnableInDev,
    wordReviewEnableInDev,
    openaiUsageReportEnableInDev,
    openaiUsageReportChatId: Number.isFinite(openaiUsageReportChatId)
      ? openaiUsageReportChatId
      : null,
    openaiUsageReportThreadId: Number.isFinite(openaiUsageReportThreadId)
      ? openaiUsageReportThreadId
      : null,
    telegramToken: isDev
      ? process.env.TELEGRAM_BOT_TOKEN_DEV
      : process.env.TELEGRAM_BOT_TOKEN,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiBotModel: process.env.OPENAI_MODEL_BOT || 'gpt-5.5',
    openaiExtractionModel: process.env.OPENAI_MODEL_EXTRACTION || 'gpt-5.5',
    openaiReportModel: process.env.OPENAI_MODEL_REPORT || 'gpt-5.5',
    openaiBotMaxCompletionTokens: positiveInt(
      process.env.OPENAI_MAX_COMPLETION_TOKENS_BOT,
      800,
    ),
    openaiExtractionMaxCompletionTokens: positiveInt(
      process.env.OPENAI_MAX_COMPLETION_TOKENS_EXTRACTION,
      3000,
    ),
    openaiReportMaxCompletionTokens: positiveInt(
      process.env.OPENAI_MAX_COMPLETION_TOKENS_REPORT,
      4000,
    ),
    messageThreshold: parseInt(process.env.MESSAGE_THRESHOLD, 10) || 100,
    databaseUrl: process.env.DATABASE_URL,
  };
};
