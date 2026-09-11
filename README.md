<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 🏛️ Tsintskaro Language Preservation Bot

A Telegram bot dedicated to preserving and revitalizing the unique dialect of the **Tsintskaro** village ancestors (Georgia).

This tool helps collect, analyze, and translate the Tsintskaro dialect—a unique blend of Old Azerbaijani and Eastern Anatolian Turkish written in Cyrillic—found in everyday community conversations.

## ✨ Features

- **Cultural Preservation**: Automatically identifies ancestral dialect words mixed into Russian conversations in Telegram groups.
- **AI Analysis**: Uses GPT-5.5 with medium reasoning by default. The first model request directly answers the question or selects the requested dictionary action, as before the usage optimization; a matching dictionary entry no longer replaces the requested explanation with a canned lookup reply.
- **Dictionary Integration**: Searches the website’s live PostgreSQL dictionary in both directions. Database changes become visible on the next lookup within 60 seconds; local edits invalidate the cache immediately.
- **Community Reporting**: Every 100 messages (or on demand) the bot generates one report: agreed and disputed dialect words plus a detailed description of the discussion. All in Russian.
- **Historical Quizzes**: Sends regular Tsintskaro history quizzes at 08:00, 10:00, 18:00, 20:00, and 22:00 Asia/Tbilisi to the thread where `/startfactday` was called. It can be paused with `/stopfactday`.
- **Dictionary Leaderboard**: `/leaderboard` shows who added the most words through the chat.
- **Conversation Context**: Replies use the latest 50 messages from the same topic (up to approximately 40,000 characters), saved instructions, and the message being replied to. Bot exchanges are retained for follow-ups but excluded from dictionary extraction reports. Replying to the bot also works without repeating its name.
- **Bot Memory**: Admins can manage stored bot instructions from Telegram with `/memory`, `/memoryadd`, `/memoryedit`, and `/memorydel`.
- **Follow-up Search**: Bot requests use the Responses API and can search the website dictionary repeatedly, including simpler phrases and alternate spellings after a miss. It also has a tool for current contributor rankings. Up to 8 tool rounds and 64 tool calls are available per question, with reasoning state and results retained between requests.
- **Complete Answers**: The default output allowances are 8,000 tokens for chat, 12,000 for extraction, and 16,000 for reports, including reasoning. A token-limit interruption is retried once with a larger allowance (up to 32,768 tokens). Long chat answers are split into Telegram messages; typing is shown while the model works. These are upper bounds, not a fixed token charge. Ordinary answers need one model call; subsequent calls are used for tools or recovery.
- **OpenAI Token Reporting**: Daily report with token totals, cache hit rate, reasoning tokens, p95 input size, model breakdown, and concrete bot tasks that consumed tokens. Configure with `/settokenreport`; inspect today with `/tokenreport`.
- **Admin Tools**: `/report` (create report now), `/status`, `/clear`, `/settokenreport`, `/tokenreport`, `/startfactday`, `/stopfactday`, `/factdaystatus`, `/factdaynow`, `/memory`.

## 🛠 Technical Stack

- **Framework**: [NestJS](https://nestjs.com/) (Node.js)
- **Platform**: Telegram Bot API (`nestjs-telegraf`)
- **NLP**: OpenAI API for linguistic analysis
- **Data Storage**: PostgreSQL shared with the website; it is the only live dictionary source.

## 🚀 Setup & Installation

### Prerequisites

- Node.js 22
- pnpm

### Installation

```bash
$ pnpm install
```

### Configuration

Create a `.env` file in the root directory (copy from `.env.example` if available) and add:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_BOT_TOKEN_DEV=your_development_bot_token
DATABASE_URL=postgres://user:password@host:5432/dbname
OPENAI_API_KEY=your_openai_api_key
# Optional
OPENAI_MODEL_BOT=gpt-5.5
OPENAI_MODEL_EXTRACTION=gpt-5.5
OPENAI_MODEL_REPORT=gpt-5.5
OPENAI_MAX_COMPLETION_TOKENS_BOT=8000
OPENAI_MAX_COMPLETION_TOKENS_EXTRACTION=12000
OPENAI_MAX_COMPLETION_TOKENS_REPORT=16000
MESSAGE_THRESHOLD=100
FACT_DAY_ENABLE_IN_DEV=false
OPENAI_USAGE_REPORT_ENABLE_IN_DEV=false
OPENAI_USAGE_REPORT_CHAT_ID=123456789
OPENAI_USAGE_REPORT_THREAD_ID=
```

For a private daily token report, the recipient must first open the bot in Telegram and run `/settokenreport`. Telegram bots cannot reliably start a private chat by username alone.

The configured database must contain the website’s `word` table. Dictionary imports and scheduled synchronization from external spreadsheets have been removed. The `etalon`, `rabochy`, and `chat` source labels remain as provenance of existing records.

Context persistence adds `contextOnly` and `isBot` columns (default `false`) and a topic/history index to `collected_message`. The app’s existing TypeORM `synchronize: true` setting applies this schema update when the new build starts. Previously skipped bot exchanges cannot be reconstructed automatically.

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
