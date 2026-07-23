<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 🏛️ Tsintskaro Language Preservation Bot

A Telegram bot dedicated to preserving and revitalizing the unique dialect of the **Tsintskaro** village ancestors (Georgia).

This tool helps collect, analyze, and translate the Tsintskaro dialect—a unique blend of Old Azerbaijani and Eastern Anatolian Turkish written in Cyrillic—found in everyday community conversations.

## ✨ Features

- **Cultural Preservation**: Automatically identifies ancestral dialect words mixed into Russian conversations in Telegram groups.
- **AI Analysis**: Uses task-specific OpenAI models to distinguish dialect words from standard Russian, infer meanings, and answer community questions.
- **Dictionary Integration**: Cross-references findings with a curated digital dictionary (`.xlsx`) to validate and catalog the language.
- **Community Reporting**: Every 100 messages (or on demand) the bot generates one report: agreed and disputed dialect words plus a detailed description of the discussion. All in Russian.
- **Historical Quizzes**: Sends regular Tsintskaro history quizzes at 08:00, 10:00, 18:00, 20:00, and 22:00 Asia/Tbilisi to the thread where `/startfactday` was called. It can be paused with `/stopfactday`.
- **Dictionary Leaderboard**: `/leaderboard` shows who added the most words through the chat.
- **Bot Memory**: Admins can manage stored bot instructions from Telegram with `/memory`, `/memoryadd`, `/memoryedit`, and `/memorydel`.
- **OpenAI Token Reporting**: Daily report with token totals, cache hit rate, reasoning tokens, p95 input size, model breakdown, and concrete bot tasks that consumed tokens. Configure with `/settokenreport`; inspect today with `/tokenreport`.
- **Admin Tools**: `/report` (create report now), `/status`, `/clear`, `/settokenreport`, `/tokenreport`, `/startfactday`, `/stopfactday`, `/factdaystatus`, `/factdaynow`, `/memory`.

## 🛠 Technical Stack

- **Framework**: [NestJS](https://nestjs.com/) (Node.js)
- **Platform**: Telegram Bot API (`nestjs-telegraf`)
- **NLP**: OpenAI API for linguistic analysis
- **Data Storage**: Excel-based dictionary management (`xlsx`)

## 🚀 Setup & Installation

### Prerequisites

- Node.js (v18+)
- pnpm

### Installation

```bash
$ pnpm install
```

### Configuration

Create a `.env` file in the root directory (copy from `.env.example` if available) and add:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key
# Optional
OPENAI_MODEL_BOT=gpt-5.5
OPENAI_MODEL_EXTRACTION=gpt-5.5
OPENAI_MODEL_REPORT=gpt-5.5
OPENAI_MAX_COMPLETION_TOKENS_BOT=800
OPENAI_MAX_COMPLETION_TOKENS_EXTRACTION=3000
OPENAI_MAX_COMPLETION_TOKENS_REPORT=4000
MESSAGE_THRESHOLD=100
FACT_DAY_ENABLE_IN_DEV=false
OPENAI_USAGE_REPORT_ENABLE_IN_DEV=false
OPENAI_USAGE_REPORT_CHAT_ID=123456789
OPENAI_USAGE_REPORT_THREAD_ID=
```

For a private daily token report, the recipient must first open the bot in Telegram and run `/settokenreport`. Telegram bots cannot reliably start a private chat by username alone.

### Running the app

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

### Test

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## 📝 License

This project is [UNLICENSED](LICENSE).
