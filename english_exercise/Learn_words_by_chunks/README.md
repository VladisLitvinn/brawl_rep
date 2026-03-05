# Learn words by chunks

A production-structured web app for **contextual English vocabulary training** using progressive chunk substitution. You see a sentence with some parts in Russian; your goal is to mentally reconstruct and type the full English sentence each round.

- **No database** — all state is in memory (session-based).
- **Backend:** Node.js + Express, OpenRouter API for generation.
- **Frontend:** React (Vite), minimal UI.

## Quick start

1. **Clone and install**

   ```bash
   cd Learn_words_by_chunks
   npm run install:all
   ```

2. **Environment**

   Copy `.env.example` to `.env` and set your OpenRouter API key:

   ```bash
   cp .env.example .env
   ```

   Edit `.env`:

   ```
   OPENROUTER_API_KEY=your_key_here
   ```

   Get a key at [OpenRouter](https://openrouter.ai/).

3. **Run**

   ```bash
   npm run dev
   ```

   - Backend: http://localhost:3001  
   - Frontend: http://localhost:5173  

   Use the app in the browser at http://localhost:5173.

## Docker Compose

Запуск через Docker (без установки Node локально):

1. Создайте `.env` из примера и укажите `OPENROUTER_API_KEY`:

   ```bash
   cp .env.example .env
   ```

2. Соберите и запустите:

   ```bash
   docker compose up --build
   ```

   - Backend: http://localhost:3001  
   - Frontend: http://localhost:5173  

   Остановка: `Ctrl+C` или `docker compose down`.

## Scripts

| Command            | Description                          |
|--------------------|--------------------------------------|
| `npm run dev`      | Start backend + frontend together     |
| `npm run server`   | Start Express only (port 3001)        |
| `npm run client`   | Start Vite dev server only (port 5173) |
| `npm run install:all` | Install root + client dependencies |

## How it works

1. **Setup** — You choose topic (optional), CEFR level (B1/B2/C1), and number of steps. Click **Generate exercise**.
2. **Generation** — The app calls OpenRouter to get one complex English sentence and 4–7 chunks (phrase + Russian translation). The backend builds progressive steps: step 0 = full English, then each step replaces one more chunk with Russian.
3. **Training** — You see the mixed sentence for the current step. You type the **full English sentence** and submit. Validation is strict (trimmed, normalized spaces, case-insensitive). **Show hint** reveals only the previous step (never the full English once you’ve moved past step 0).
4. **Completion** — When you finish the last step, you see a success screen and can start a new exercise.

## Project structure

```
/client
  src/
    App.jsx              # Screen routing, state
    main.jsx
    index.css
    components/
      SetupScreen.jsx    # Topic, level, iterations, Generate
      TrainingScreen.jsx # Sentence display, input, Submit, Hint
    services/
      api.js             # generate, validate, requestHint
/server
  index.js               # Express, CORS, mount API
  routes/
    api.js               # POST /api/generate, /api/validate, GET /api/state
  services/
    openrouter.js        # OpenRouter client, prompt, parse JSON
    steps.js             # Progressive step generation
  store.js               # In-memory session store
package.json
.env.example
README.md
```

## API

- **POST /api/generate** — Body: `{ topic?, level, iterations? }`. Returns session data and steps. Session is stored in memory keyed by `X-Session-Id` or body `sessionId`.
- **POST /api/validate** — Body: `{ input }` to validate answer; or `{ requestHint: true }` for hint. Returns `correct`, `done`, `currentStep`, `displaySentence`, etc.
- **GET /api/state** — Query `sessionId` (or header `X-Session-Id`). Returns current step and display sentence.

## Edge cases

- Invalid JSON from LLM → user-friendly error.
- OpenRouter timeout → error message.
- Empty or too few chunks → validation and error.
- Overlapping or duplicate chunks → detected when building steps; error returned.
- Very short sentence → rejected during parse.

## Extending

- Add more models or prompts in `server/services/openrouter.js`.
- Adjust step logic (e.g. chunk order) in `server/services/steps.js`.
- Add persistence by replacing `server/store.js` with a DB or file store while keeping the same API.
