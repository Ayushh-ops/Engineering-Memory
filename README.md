# Engineering Memory

See what breaks before you change it. Analyze any public GitHub repository.

Live demo: <ADD LIVE URL HERE>

The free server sleeps after 15 minutes of inactivity. The first request may take about a minute to wake up.

## What it does

- Maps dependencies, symbols, imports, and callers across repository files.
- Calculates change impact, downstream blast radius, risk scores, and affected tests.
- Provides a context-aware AI assistant grounded in repository structure, commit history, and code evidence.

## Features

- Overview: repository health summary, high-risk hotspot files, and complexity signals.
- Plan a change: select multiple target files to review combined risk scores and recommended tests to run.
- Health: circular dependency detection, unused and orphaned files, and high-complexity god files.
- Graph: interactive 2D node-link graph and 3D force-directed dependency visualization.
- Impact: inspect blast radius, direct callers, indirect downstream consumers, and related tests.
- Connections: dependency tree showing direct imports, imported by, and call-site evidence.
- Code viewer: syntax-highlighted source browser with line jumping from evidence chips.
- History and owners: author commit breakdown, ownership shares, and recent file changes.
- Ask AI: grounded answers with line evidence chips, automatic response length and language detection (English, Hinglish, Hindi), image attachments, streaming replies, and follow-up prompts.

## How to use

1. Paste a public GitHub repository URL (or `owner/repo`) into the search bar.
2. Wait for the initial repository analysis and dependency graph build.
3. Open the command palette with Ctrl K (or click the search button) to select a file.
4. Explore tabs (Overview, Plan, Health, Graph, Impact, Connections, History) or ask questions in Ask AI.

## Tech stack

- Frontend: React 19, Vite, Tailwind CSS, three.js, react-force-graph-3d, @xyflow/react, Zustand.
- Backend: Node.js, Express 5, TypeScript.
- AI: Groq (OpenAI-compatible API) with Google Gemini fallback.
- Analyzers: tree parsing and symbol extraction for TypeScript, JavaScript, Python, Java, Go, and C++.

## Run locally

Requirements: Node.js 20+ and npm.

1. Install backend and frontend dependencies:
   ```bash
   npm install
   npm --prefix frontend install
   ```
2. Copy environment configuration:
   ```bash
   cp .env.example .env
   ```
3. Start development servers:
   - Backend (port 3000): `npm run dev`
   - Frontend (port 5173): `npm --prefix frontend run dev`
4. Build and run production bundle locally:
   ```bash
   npm run build:all
   npm start
   ```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Optional | GitHub personal access token to raise rate limit from 60 to 5,000 req/hr. |
| `LLM_API_KEY` | Optional | Primary LLM API key (e.g. Groq). |
| `LLM_BASE_URL` | Optional | Base URL for primary LLM endpoint (default: `https://api.groq.com/openai/v1`). |
| `LLM_MODEL` | Optional | Primary model name (default: `openai/gpt-oss-120b`). |
| `LLM_FALLBACK_API_KEY` | Optional | Fallback LLM API key (e.g. Gemini via OpenAI-compatible endpoint). |
| `LLM_FALLBACK_MODEL` | Optional | Fallback model name (default: auto-discovered from Gemini). |
| `LLM_TIMEOUT_MS` | Optional | Request timeout in milliseconds (default: 20000). |
| `LLM_MAX_TOKENS` | Optional | Max completion token budget (default: 1500). |
| `NODE_ENV` | Optional | Environment mode (`production` serves frontend static files). |
| `PORT` | Optional | Server port (default: 3000). |

Models and URLs have built-in defaults. The server starts without keys; if an AI key is missing, Ask AI returns a friendly notification. Never commit real keys or secrets to the repository.

## Deploy on Render (free)

1. Create a new Web Service and link your GitHub repository.
2. Set configuration:
   - Build command: `npm install && npm run build:all`
   - Start command: `npm start`
3. Add environment variables in the Render dashboard:
   - `NODE_ENV=production`
   - `NPM_CONFIG_INCLUDE=dev`
   - Add optional API keys (`GITHUB_TOKEN`, `LLM_API_KEY`, `LLM_FALLBACK_API_KEY`).
4. Verify deployment by visiting `https://<your-app>.onrender.com/healthz`.

Tip: Ping `/healthz` every 5 minutes using a free uptime monitor (e.g. UptimeRobot) to prevent the free instance from sleeping.

## Limits and known issues

- Public repositories only: private repositories are not supported yet.
- Repository cap: analysis processes up to the first 500 supported source files (configurable via `ANALYSIS_MAX_FILES`).
- Memory limits: very large repositories can cause high latency or exceed the 512 MB memory limit on free hosting tiers.
- AI rate limits: free-tier keys on Groq and Gemini enforce strict TPM/RPM quotas; when reached, Ask AI shows a countdown and retry period.
- GitHub API rate limits: anonymous GitHub requests are capped at 60 requests/hr per IP; set `GITHUB_TOKEN` to increase the ceiling to 5,000 requests/hr.

## Troubleshooting

| Problem | Cause | Solution |
| --- | --- | --- |
| Repository not found | Repository is private or URL is misspelled | Ensure the repository is public and the owner/name format is correct. |
| GitHub rate limit reached | Exceeded 60 anonymous requests per hour | Add a `GITHUB_TOKEN` in `.env` or in host environment variables. |
| AI service unreachable or rate limited | Missing API key, exhausted quota, or provider outage | Verify `LLM_API_KEY` and quota; configure `LLM_FALLBACK_API_KEY` for automatic fallback. |
| 413 payload too large | Repository payload exceeds body parser limit | Update to latest build; select a specific target file rather than full repository scope. |
| Analysis stuck or fails mid-run | Repository exceeds memory or contains very deep trees | Reduce analyzed scope or restart instance if memory is exhausted. |
| Blank page after deploy | Frontend build missing or start command misconfigured | Ensure build command runs `build:all` and start command runs `node dist/index.js`. |

## Security

Never commit `.env` or share API tokens. Store credentials in `.env` locally or in the hosting dashboard. Rotate any API key that was ever committed or shared publicly.

## Project structure

```text
EngineeringMemory/
├── src/
│   ├── ai/            # Ask AI routing, prompt builder, providers, and response services
│   ├── analyzers/     # AST analyzers for TypeScript, Python, Java, Go, and C++
│   ├── github/        # GitHub API client and file cache
│   ├── graph/         # Repository dependency graph, context assembler, and query engine
│   ├── middleware/    # Express rate limiting and security headers
│   ├── resolvers/     # Import path resolution across languages
│   ├── routes/        # API endpoints (repositories, impact, ai, health)
│   └── services/      # Change impact, orchestration, and expansion services
├── frontend/
│   ├── public/        # Static assets (favicon, manifest)
│   └── src/
│       ├── components/# UI views (MainPanel, Sidebar, TopBar, Graph3D, CodeViewer)
│       ├── api.ts     # Frontend HTTP client and SSE stream reader
│       └── store.ts   # Zustand app state and snapshot storage
```

## Roadmap

- Private repository login via GitHub OAuth.
- Saved analyzed repositories page for persistent project history.
- GitHub Action that comments risk scores and blast radius directly on pull requests.
