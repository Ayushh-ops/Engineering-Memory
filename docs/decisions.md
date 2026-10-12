# Technical decisions

This document describes architectural and engineering decisions evidenced by the repository.

## TypeScript across the full stack

Both backend and frontend are written in TypeScript with strict compiler settings. Express request and response payloads, GitHub API models, in-memory graph schemas, impact analysis contracts, and Zustand store states are strongly typed end-to-end.

## Express HTTP server with modular route boundaries

Express provides HTTP routing, JSON payload parsing (with a 15 MB limit for graph payloads), and Server-Sent Events (SSE) streaming. Routes are separated by domain (`/api/health`, `/api/repositories`, `/api/file`, `/api/analyze`, `/api/impact`, `/api/ai`) and delegate business logic to pure domain services.

## Node's built-in `fetch` with 15-second timeouts

The GitHub and LLM integrations use the native `fetch` API supplied by Node.js 20+ rather than external HTTP client libraries. Every GitHub API call enforces a 15-second timeout via `AbortSignal.timeout(15_000)` to ensure upstream network stalls never leave requests hanging.

## Structured GitHub error mapping

GitHub API responses and network failures are mapped through `mapGitHubErrorToHttp` into deterministic JSON payloads containing HTTP status, machine-readable `code`, `message`, and optional `retryAfterSeconds`:
- `404` -> `repo_not_found` ("Repository not found. Check the URL, or it may be private.")
- `403` / `429` with exhausted rate-limit headers -> `github_rate_limited` (computes `retryAfterSeconds` from `x-ratelimit-reset`)
- `401` -> `github_auth_failed` ("The GitHub token is invalid. Check GITHUB_TOKEN in .env.")
- `AbortError` / `TimeoutError` / network fetch errors -> `github_unreachable` ("Cannot reach GitHub. Check your internet connection.")
- Empty tree or zero supported source files -> `repo_empty` ("No supported source files found in this repository.")

## Optional GitHub authentication without automatic retries

GitHub authentication is opt-in through the `GITHUB_TOKEN` environment variable. A shared request-options helper adds a Bearer authorization header only when a non-empty token is configured, preserving unauthenticated public access otherwise. Rate-limit responses are surfaced immediately as structured errors rather than triggering automatic retries, avoiding request amplification. Tokens are never logged or echoed in error payloads.

## Multi-language source analyzers without native binary dependencies

Rather than requiring native language toolchains or external parser binaries at runtime, `src/analyzers/registry.ts` combines the TypeScript Compiler API (for `.ts`, `.tsx`, `.js`, `.jsx`) with lightweight, deterministic structural analyzers for Python (`.py`), Go (`.go`), Java (`.java`), and C/C++ (`.c`, `.cc`, `.cpp`, `.h`, `.hpp`). All analyzers emit a unified `FileAnalysis` contract (`imports`, `classes`, `functions`, `variables`, `relationships`) so downstream graph construction and impact analysis remain language-agnostic.

## Querying supplied graphs without persistence

Repository graph queries, impact calculations, and context assembly operate on a `RepositoryGraph` supplied in the request rather than requiring a database. This keeps the backend stateless and reproducible while allowing the frontend to hold the active repository graph in memory.

## Deterministic bounded context assembly

Context assembly (`src/graph/context.ts`) is a pure module over an existing `RepositoryGraph`. It composes direct query functions, supports file, symbol, and commit targets, and performs bounded selection with configurable limits and hard maximums. Historical context uses commit and `symbol-change` nodes without creating phantom structural nodes for removed declarations.

## Rejecting inconsistent AI context before provider calls

The repository graph is the single source of truth for AI context. `validateRepositoryContextConsistency` runs in `AiAnswerService` after repository context assembly and before `buildAiContext`. Any deterministic contradiction (`status: "invalid"`) stops the request with a controlled `invalid_graph` error instead of sending unverifiable facts to an LLM provider. Call-site evidence must be reachable through an impact path relationship, and validation is fail-closed.

## Bounded compact impact projection for AI context

`ChangeImpactAnalysisResult` remains the deterministic source of truth for API consumers, while `src/ai/impact-context.ts` normalizes impact results into a compact consumer-centric projection (`consumers`, pooled relationships, per-consumer chains, nested call sites) bounded to the remaining character budget in `buildAiContext`. When the budget binds, whole consumers lose path and call-site detail as a unit while `compaction` counters, `totals`, and explicit limitation strings preserve transparency without truncating strings or dropping consumers.

## Serving change-impact results directly over HTTP

`POST /api/repositories/graph/impact` and `POST /api/impact/batch` expose `ChangeImpactAnalysisService` directly over HTTP. Single-target impact responses run through `validateRepositoryContextConsistency` before returning, and batch impact calculations compute risk summaries (`high`, `medium`, `low`) across up to 200 files in a single round-trip for the frontend explorer.

## Question-aware AI routing, greeting fast-path, and fact-based fallback

`POST /api/ai/ask-repository` classifies user questions (`greeting`, `Quick`, `Symbol / file`, `Impact`, `History`, `Architecture`, `General`) before planning context:
- **Greetings and small talk**: Answered immediately using cached `repoFacts` and the selected file path without fetching any file content from GitHub or running the context builder, ensuring instant responses even when GitHub is unreachable.
- **Resilient file-content fallback**: For non-greeting questions where fetching the selected file from GitHub fails, the route degrades gracefully by answering from the request's existing `repoFacts` (risk level, dependents, owners, commits) and appending a single-sentence note (`Note: The file content could not be loaded from GitHub, so this answer is based on the repository facts already loaded.`) rather than failing the request.
- **Dual-provider LLM fallback chain**: Primary OpenAI-compatible provider (`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`, defaulting to Groq `llama-3.3-70b-versatile`) automatically falls back to Gemini (`LLM_FALLBACK_API_KEY` / `LLM_FALLBACK_MODEL`) with runtime model discovery if the primary provider is rate-limited, unreachable, or unconfigured.

## Resilient frontend analysis lifecycle and offline handling

- **Client-side URL validation**: `validateRepoInput` validates GitHub URLs (`https://github.com/owner/repo`, `.git`, `/tree/...`, `/blob/...`) and `owner/repo` shorthand before opening the analyzing progress view or calling the backend.
- **Non-destructive error handling**: Failed or cancelled repository analyses display an inline error card in place of the progress box while preserving any previously loaded repository in the Zustand store.
- **Timeout and cancellation**: Analysis requests wire an `AbortController` to a Cancel button available throughout analysis and display a warning ("This is taking longer than expected") after 90 seconds.
- **Offline detection in Ask AI**: When `navigator.onLine` is false or a fetch network error occurs, the UI immediately renders a "You are offline" state with a Retry button without dispatching a doomed network request.
