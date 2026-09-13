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
- **Historical Quizzes**: Sends regular Tsintskaro history quizzes at 07:00, 09:00, 17:00, 19:00, and 21:00 Moscow time to the thread where `/startfactday` was called. It can be paused with `/stopfactday`.
- **Dictionary Leaderboard**: `/leaderboard` shows who added the most words through the chat.
- **Dictionary Review**: `/startreview` starts a dictionary pass in the current topic with 10 words by default. The first delivery is immediate; subsequent deliveries follow a three-day cycle at 08:00 Moscow time. `/stopreview` pauses delivery without deleting progress, `/reviewsize 1..100` changes future batch sizes, and `/reviewstatus` shows progress and the next scheduled time. Batches are plain numbered lists for open discussion; `/reviewnow` sends an extra batch without waiting for earlier discussions.
- **Moscow Time**: Bot timestamps, deadlines, schedules and AI replies use `Europe/Moscow` and the label `МСК`. Existing delivery instants and the review cycle's Tbilisi calendar anchor are preserved. Token reports cover Moscow calendar days and are delivered daily at 08:00 Moscow time.
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

### Word review controls

Run these commands as an administrator in **Язык (профессионалы)**:

- `/reviewsize 10` — save the number of words for future batches (1–100). This can be configured before starting.
- `/startreview` — start or resume delivery in this topic. On first start, send the first batch immediately and anchor the schedule to today's Tbilisi date. Starting on September 13 by that calendar schedules September 16, 19, 22, etc. at 08:00 Moscow time.
- `/stopreview` — pause new deliveries, retaining the target, batch size, schedule and review history. Participants can continue discussing already published lists.
- `/reviewstatus` — show delivery status, batch size, next due date, reviewed/disputed/open word counts and the number of fully reviewed batches.
- `/reviewnow` — send an extra batch even while other batches are being discussed or automatic delivery is paused. This does not resume automation or change the next regular date, including when that date is overdue.

`/setreviewchat` and `/clearreviewchat` are aliases for start and stop. Configuration is bound to one topic; commands in other topics cannot change it. Repeating start does not reset progress or send extra words before the next due date. If the bot was offline or paused at a due time, it sends one overdue batch when able, then resumes the original three-day cycle. Earlier discussions never block new batches. Concurrent deliveries use different word IDs; concurrent scheduler runs cannot send the same scheduled slot twice.

Batches contain **numbered lists, with no voting or correction buttons**. Each dialect word or phrase is a separate Telegram inline-code entity for copying; its number and translation remain ordinary text. The message shows an advisory discussion deadline of 21:00 Moscow time on the following Tbilisi calendar day, preserving the deadline from the meeting notes. Discussion is open to all participants; the bot does not impose a voter count, restrict replies at the deadline, or automatically mark words as reviewed. A reply to a batch message is ordinary discussion unless it explicitly addresses the bot or gives an explicit correction or review outcome. Legacy button callbacks remove their keyboard and never apply votes or corrections. Historical votes remain stored.

Review outcomes are recorded through explicit messages, with no additional slash command:

- **«Баласи, партия №5 разобрана»** — mark every word in that batch as reviewed.
- **«Баласи, партия №5 разобрана, кроме слов 3 и 7»** — review the other words and keep 3 and 7 disputed. **«Партия №5 разобрана. Слова 3 и 7 пока спорные»** has the same meaning.
- **«Баласи, в партии №5 разобраны слова 1, 2 и 4»** — review only those entries; leave all others in their existing states.
- **«Баласи, в партии №5 слово ширин разобрано»** — review an entry by its exact name in the published list. **«Баласи, слово ширин проверено»** also works when the name identifies exactly one batch in this topic.
- **«Баласи, в партии №5 слова 3 и 7 спорные»** — explicitly keep or reopen those entries as disputed.

An explicit outcome replying to any page of a batch works without the bot's name or batch number. Otherwise, address the bot. Bare chat discussion, questions, negations, expired deadlines and translation changes do not close a review. Unclear instructions ask for clarification without calling the AI action agent. A missing/ambiguous word, unknown number, conflicting reply and batch number, or wrong topic prevents the entire decision from being applied. The bot never guesses the latest batch. Delivery must finish before a batch can be reviewed; pausing future deliveries does not prevent recording outcomes.

Only administrators under the bot's existing access rules and coordinators listed by Telegram user ID in **`WORD_REVIEW_COORDINATOR_IDS`** can record outcomes. Separate IDs with commas; with an empty setting, only administrators have access. Outcomes must be original messages from an identifiable personal account. Naming Катя or Жанна in chat does not grant access; their actual Telegram IDs must be configured if they are not already administrators.

After saving, the bot explicitly reports whether the batch is **fully reviewed**, **partly reviewed**, or **not yet reviewed**, and lists every reviewed, disputed and pending entry by number and word. `word_review_item.status` becomes `confirmed` or `disputed`; unmentioned entries retain their state. `confirmedAt` records completion time. A batch becomes `completed` with `completedAt` only when all its items are confirmed. Explicitly reopening a dispute clears the relevant completion timestamps and returns the batch to `published`. Review decisions do not alter the delivery schedule or dictionary translations.

`word_review_decision` stores an append-only record of the actor's Telegram ID/name, batch, chat/topic, source message, timestamp and status changes for each affected item. The changes and completion state are saved together in a transaction under the review lock. The unique chat/message pair prevents replaying the same Telegram message, even after later decisions. Retrying an already recorded message reports current state rather than reapplying its old decision. This audit concerns review status; translation edit history remains separate.

To replace a translation, address the bot normally: **«Баласи, замени перевод слова ширин на сладкий»**. This replaces the entire previous translation. **«Добавь ещё значение»** continues to append meanings. No separate slash command is required. Clear replacement requests are parsed directly; more conversational wording uses the existing model and reply/history context. A short reply such as «замени перевод на сладкий» uses context to identify the word, or asks for clarification when multiple words are possible. An explicit correction replying to a batch is also handled; ordinary comments remain discussion.

Only **@joanofarc74** and **@ekaterina_karaasheva** can change existing translations through the bot. The allowlist matches the actual Telegram sender's username, case-insensitively; administrator status, display names, forwarded authors and usernames mentioned in the message do not grant this permission. Bot and anonymous chat identities cannot edit translations. This restriction applies to full replacements, appending meanings to existing words, compound spelling/translation edits and merges of existing entries. It is enforced by the dictionary write methods as well as the conversational update handler. Other participants can still add genuinely new words, and spelling/POS-only writes omit the translation field so they cannot overwrite an editor's concurrent translation change. Review outcome permissions are configured separately.

Translation-only replacements save the previous/new translations, word ID, editor's Telegram ID/name, chat/topic/message and timestamp in `word_translation_history`. The word update and audit entry commit in one transaction with a row lock. The bot shows “Было / Стало”; repeating an unchanged translation creates no extra history entry. Replacement changes only the translation, preserving source, author and part of speech. Existing posted batches retain their original snapshots. Compound edits that also rename a word or change its part of speech continue through the existing dictionary update path with the same translation permission check.

The first start saves `dictionaryCutoffAt`: the pass includes all dictionary sources created by that time, in the existing Tsintskaro alphabet order, excluding word IDs already included in review items or historical deliveries. Even words with empty translations remain eligible. New dictionary records after this cutoff wait until the current pass finishes. For example, adding an «а» word while the pass is on «б» does not interrupt that pass. Once no unsent words remain in the snapshot, the next delivery automatically takes a new snapshot and starts from the beginning of the alphabet among the unsent additions. A final short batch is not filled with words from the next pass. Additions during that next pass wait for a later pass in the same way.

The selection flag is whether a word has already been included in a review batch, tracked by its word ID in `word_review_item` and the legacy delivery history. This is separate from the coordinator's `confirmed` status: both reviewed words and words with an ongoing discussion/dispute stay out of new batches. Their existing discussions remain open until an explicit outcome is recorded. There is no automatic resending of disputed entries. The new cutoff is saved together with the first batch of its pass, so delivery retries preserve that pass. Cutoff and history survive stop/start; advancing a pass does not change the three-day schedule. `/reviewnow` can advance an exhausted pass while paused without resuming automation or shifting the schedule. If no additions are available, no empty batch is created, and regular checks continue on the schedule. `/reviewstatus` separately shows unsent words in the current pass and additions waiting for the next one.

`word_review_batch.reviewFlow` records the review stream independently of the mutable `word.source` field: new batches use `dictionary`, historical batches default to `legacy_chat`, and `learning` is reserved for a separate learning-topic workflow. Individual words are linked through `word_review_item`; a future learning workflow must select and track its own queue. Automatic collection/routing of that separate workflow is not configured by these commands.

Lists use pages of up to 10 entries within the message size limit. Full words and translations are retained; an exceptionally long entry continues in the next message. The bot persists page message IDs and resumes interrupted delivery from the first unsent page. PostgreSQL advisory locking serializes delivery and configuration changes across bot instances. As with any Telegram send, an interruption after Telegram accepts a message but before its ID is saved can require manual reconciliation; Telegram provides no application-supplied idempotency key for this operation.

The existing `synchronize: true` setup adds the review settings, batch fields, `word_review_decision` and `word_translation_history` tables on application startup. Existing targets begin paused and require `/startreview` to opt into the new schedule. No changes to the shared website `word` table are needed for these controls or stream labels.

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
