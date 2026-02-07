<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 🏛️ Tsintskaro Language Preservation Bot

A Telegram bot dedicated to preserving and revitalizing the unique dialect of the **Tsintskaro** village ancestors (Georgia).

This tool helps collect, analyze, and translate the Tsintskaro dialect—a unique blend of Old Azerbaijani and Eastern Anatolian Turkish written in Cyrillic—found in everyday community conversations.

## ✨ Features

*   **Cultural Preservation**: Automatically identifies ancestral dialect words mixed into Russian conversations in Telegram groups.
*   **AI Analysis**: Uses **OpenAI (GPT-4o)** to distinguish dialect words from standard Russian and infer meanings from context.
*   **Dictionary Integration**: Cross-references findings with a curated digital dictionary (`.xlsx`) to validate and catalog the language.
*   **Community Reporting**: Every 100 messages (or on demand) the bot generates one report: agreed and disputed dialect words plus a detailed description of the discussion. All in Russian.
*   **Admin Tools**: `/report` (create report now), `/status`, `/clear`.

## 🛠 Technical Stack

*   **Framework**: [NestJS](https://nestjs.com/) (Node.js)
*   **Platform**: Telegram Bot API (`nestjs-telegraf`)
*   **NLP**: OpenAI API for linguistic analysis
*   **Data Storage**: Excel-based dictionary management (`xlsx`)

## 🚀 Setup & Installation

### Prerequisites

*   Node.js (v18+)
*   pnpm

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
MESSAGE_THRESHOLD=100
```

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
