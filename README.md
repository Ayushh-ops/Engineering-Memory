# Engineering Memory

Engineering Memory analyzes public GitHub repositories to map code dependencies, ownership, and history.
It provides change impact analysis to reveal what might break before you make modifications.
An integrated AI assistant answers questions grounded in code structure, commits, and file evidence.

## Features

- Interactive dependency graph visualization for files, classes, functions, and imports
- Change impact and blast-radius analysis across downstream dependents
- Commit history, author ownership breakdown, and risk scoring
- Question-aware Ask AI with streaming responses, evidence citations, and offline fallback
- Source parsing support for TypeScript, JavaScript, Python, Go, Java, and C++

## Requirements

- Node.js 20+
- npm

## Setup

1. Install root dependencies:
   ```bash
   npm install
   ```

2. Install frontend dependencies:
   ```bash
   npm install --prefix frontend
   ```

3. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```

4. Configure environment variables (names only):
   - `GITHUB_TOKEN`: (Optional) GitHub Personal Access Token to raise the API rate limit from 60 to 5,000 requests per hour.
   - `LLM_API_KEY`: (Optional) API key for the primary LLM provider.
   - `LLM_BASE_URL`: (Optional) Base URL for the primary LLM provider endpoint.
   - `LLM_MODEL`: (Optional) Primary model identifier.
   - `LLM_FALLBACK_API_KEY`: (Optional) API key for the fallback LLM provider.
   - `LLM_FALLBACK_MODEL`: (Optional) Fallback model identifier.

   Models and URLs have built-in defaults. Providers such as Groq and Gemini impose free-tier rate limits and quotas.

## How to Run

- Backend:
  ```bash
  npm run dev
  ```
  Runs on port `3000` (`http://localhost:3000`).

- Frontend:
  ```bash
  npm run dev --prefix frontend
  ```
  Runs on port `5173` (`http://localhost:5173`).

## How to Use

1. Open the application in your browser at `http://localhost:5173`.
2. Enter a GitHub repository URL (e.g. `https://github.com/owner/repo` or shorthand `owner/repo`).
3. Explore the visual graph, file tree, commit logs, risk levels, and blast radius.
4. Use Ask AI to investigate dependencies, understand impact, and inspect file details.

## Deploy

Engineering Memory can be deployed as a single unified service where Express serves the compiled frontend SPA and backend API.

### Render

1. Create a new **Web Service** and connect your repository.
2. Set the build and start commands:
   - **Build Command**: `npm install && npm run build:all`
   - **Start Command**: `npm start`
3. Add environment variables in the host dashboard (names only):
   - `NODE_ENV=production`
   - `GITHUB_TOKEN` (optional)
   - `LLM_API_KEY` (optional)
   - `LLM_BASE_URL` (optional)
   - `LLM_MODEL` (optional)
   - `LLM_FALLBACK_API_KEY` (optional)
   - `LLM_FALLBACK_MODEL` (optional)

All keys and credentials must be set only in the host dashboard. Note that free host instances spin down after 15 minutes of inactivity and take up to a minute to wake on the first request. You can keep the service warm by setting up a free monitoring tool like [UptimeRobot](https://uptimerobot.com) to ping `GET /healthz` every 5–10 minutes.

## Troubleshooting

| Issue | Cause | Solution |
| --- | --- | --- |
| Rate limit | LLM provider token or request quota reached | Wait for the provider cooldown or configure `LLM_FALLBACK_API_KEY` in `.env`. |
| No API key | `LLM_API_KEY` is not set | Add your LLM provider key to `.env`. Basic facts and greetings still operate without a key. |
| GitHub rate limit | GitHub anonymous rate limit (60 requests/hr) reached | Add a `GITHUB_TOKEN` to `.env` to raise the limit to 5,000 requests/hr. |
| Private repos are not supported yet | Attempted to analyze a private repository | Currently only public GitHub repositories are supported. Verify repository visibility. |
| 413 | The repository or context payload is too large | Select a specific file to analyze or reduce the number of queried files. |

## Security Note

Never commit your `.env` file or expose your API tokens. Keep credentials local and verify that `.env` is ignored by version control.
