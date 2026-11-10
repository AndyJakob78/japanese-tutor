# Japanese Language Learning Article Generator

## ⚡ Read these first (operational context)
- **[KNOWLEDGE_HUB.md](KNOWLEDGE_HUB.md)** — architecture, production environment, pipeline post-processing chain, known Claude hallucinations log, common operational tasks, things to never do without asking. **Start here when picking up work or debugging.**
- **[DEPLOY.md](DEPLOY.md)** — exact deploy command, smoke test, rollback procedure. **Read before deploying.**

## Project Overview
iOS app + Node.js backend that generates Japanese language learning articles from real current news using Claude AI. No chat interface — users trigger article generation, read articles in Hepburn romaji, study vocabulary, and take quizzes.

## Tech Stack
- **Backend**: Node.js 20 (Express), plain JavaScript (CommonJS), deployed on Cloud Run (`europe-west1`)
- **iOS**: Swift / SwiftUI (iOS 17+, @Observable pattern)
- **AI**: Claude API with `web_search` tool (model: see [server/services/claude.js](server/services/claude.js))
- **Database**: Google Firestore (project `japanese-tutor-487503`) — NOT SQLite (older docs may say SQLite, this is outdated)
- **Payments / trial**: RevenueCat (per-device trial via `X-User-ID` header)

## Conventions
- Plain JavaScript with `require()` — no TypeScript, no build step
- All Japanese text in user-facing output: Hepburn romaji with macrons (ā, ī, ū, ē, ō)
- Never output hiragana/katakana/kanji in articles — store in DB for reference only
- No authentication — small-scale app for a few users
- Skills files in `skills/` directory encode domain expertise for the agent pipeline
- Agent pipeline steps in `agent/steps/` — each step is a separate module

## Project Structure
```
├── skills/                  # Domain expertise for the agent pipeline
├── agent/                   # Agent pipeline orchestrator + steps
│   ├── pipeline.js          # Main orchestrator
│   ├── steps/               # 5 pipeline steps
│   └── prompts/             # Prompt templates
├── server/                  # Express API server
│   ├── index.js             # Entry point
│   ├── routes/              # API route handlers
│   ├── services/            # Claude API wrapper, DB service
│   └── middleware/           # Express middleware
├── database/                # Schema, seeds, migrations
└── ios/                     # SwiftUI iOS app
    └── JapaneseTutor/
```

## Running the Backend
```bash
npm install
cp .env.example .env         # Add your ANTHROPIC_API_KEY
node server/index.js          # Starts on port 3000
```

## Key API Endpoints
- `POST /api/articles/generate` — trigger full article generation pipeline
- `GET /api/articles` — list articles
- `GET /api/articles/:id` — get article with vocabulary + quiz
- `GET /api/vocabulary` — browse vocabulary
- `GET /api/articles/:id/quiz` — get quiz for an article
