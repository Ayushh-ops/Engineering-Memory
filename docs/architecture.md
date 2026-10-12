# Architecture

## Overview

Engineering Memory is a full-stack code intelligence platform consisting of a TypeScript and Express HTTP service and a React 19 single-page frontend. The backend exposes API endpoints under `/api`, retrieves public repository data from the GitHub REST API with 15-second request timeouts, builds deterministic in-memory structural graphs across multiple programming languages, performs change-impact analysis, and orchestrates context-grounded AI answers.

## Express application and routes

`src/app.ts` creates the Express application, enables `express.json()` middleware, and mounts the route modules beneath `/api`.

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| `/api/health` | `GET` | Returns `{ status: "ok", timestamp }` to indicate the service is running. |
| `/api/repositories` | `POST` | Validates a GitHub repository URL, retrieves repository metadata, and returns a reduced API response. |
| `/api/repositories/commits` | `POST` | Validates a GitHub repository URL, retrieves recent commits and their changed-file statistics, and returns a reduced commit list. |
| `/api/repositories/owners` | `POST` | Computes file-level commit ownership share and bus-factor risk from recent commit history. |
| `/api/repositories/tree` | `POST` | Retrieves the recursive Git tree for a commit SHA, filters supported source files, and returns ordered file paths (or `repo_empty` if none exist). |
| `/api/repositories/file` | `POST` | Validates a GitHub repository URL, file path, and commit SHA, then retrieves UTF-8 file content at that revision. |
| `/api/file` | `GET` | Query-parameter variant for retrieving historical UTF-8 file content at a specific commit SHA. |
| `/api/repositories/analyze-file` | `POST` | Retrieves one historical file at a supplied SHA and returns the language analyzer's structured result. |
| `/api/repositories/analyze` | `POST` | Retrieves and analyzes up to 20 supplied files at one supplied SHA (supports JSON and SSE progress streaming), returning structured results, resolved relative-import links, and an in-memory structural graph. |
| `/api/repositories/analyze-history` | `POST` | Retrieves a commit and its first-parent comparison for up to 20 supplied files, returning structural symbol changes and an additive historical graph. |
| `/api/repositories/graph/query` | `POST` | Executes a validated, read-only query against a caller-supplied in-memory repository graph. |
| `/api/repositories/graph/context` | `POST` | Assembles bounded, deterministic one-hop context for a target in a caller-supplied graph. |
| `/api/repositories/graph/impact` | `POST` | Returns the deterministic change-impact result for a file or symbol target in a caller-supplied graph, re-validated against that graph. |
| `/api/repositories/graph/health` | `POST` | Computes structural health metrics (circular imports, unused files, god files) over a caller-supplied graph. |
| `/api/impact/batch` | `POST` | Computes change-impact summaries across multiple file paths in a single batch call. |
| `/api/analyze` | `POST` | Validates a source string and returns focused AST-derived structure. |
| `/api/ai/ask` | `POST` | Answers a question from a caller-supplied repository graph without contacting GitHub. |
| `/api/ai/ask-repository` | `POST` | Orchestrates repository context, deterministic graph analysis, bounded source evidence, greeting/small-talk interception, and streaming or JSON LLM responses with automatic fallback to static facts if file retrieval fails. |

## Multi-language AST analysis flow

1. `src/analyzers/registry.ts` dispatches source analysis by file extension across supported languages:
   - **TypeScript / JavaScript** (`.ts`, `.tsx`, `.js`, `.jsx`): `src/analyzers/typescript.ts` using the TypeScript Compiler API (`ts.createSourceFile`).
   - **Python** (`.py`): `src/analyzers/python.ts` extracting imports, classes, methods, functions, and calls.
   - **Java** (`.java`): `src/analyzers/java.ts` extracting package imports, classes, methods, and invocations.
   - **Go** (`.go`): `src/analyzers/go.ts` extracting imports, structs/types, functions, methods, and calls.
   - **C++** (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`): `src/analyzers/cpp.ts` extracting `#include` directives, classes, functions, and calls.
2. Each analyzer returns a uniform structure: import source paths, class names with method names and parameter names, function names with parameter names, variable names, and structural relationships (`imports` and `calls`). No raw AST is exposed.

## Historical file-analysis flow

1. A client sends `POST /api/repositories/analyze-file` with a repository URL, file path, and commit SHA.
2. The repository route validates the URL, path, and SHA.
3. The shared historical-file helper calls GitHub's contents API with the SHA as `ref` and a 15-second timeout, rejects directories, and decodes the Base64 file response as UTF-8.
4. The route passes the decoded source string to `analyzeSource` in `src/analyzers/registry.ts`.
5. It returns the repository identifier, supplied path and SHA, and the structured `analysis` result.

## Repository-level historical analysis flow

1. A client sends `POST /api/repositories/analyze` with a repository URL, a non-empty SHA, and 1–20 non-empty file paths. If the client sends `Accept: text/event-stream`, the route streams real-time progress stages (`Cloning repository`, `Parsing symbols`, `Linking calls and imports`, `Building the graph`) via Server-Sent Events (SSE).
2. The repository route validates the URL (`parseGitHubRepoInput` / `parseGitHubRepositoryUrl`), SHA, and paths before contacting GitHub.
3. It retrieves every requested path concurrently through the shared historical-file helper with a 15-second timeout.
4. If any file retrieval fails, the route returns a structured JSON error (or SSE error event) with a mapped error code (`repo_not_found`, `github_rate_limited`, `github_auth_failed`, `github_unreachable`).
5. It runs the language analyzer for each decoded file through `src/analyzers/registry.ts`.
6. A repository-level resolver walks import relationships in requested-file order, normalizing relative segments and matching candidates against the supplied path set.
7. `src/graph/repository-graph.ts` builds ordered, de-duplicated `repository`, `file`, `class`, `function`, and `method` nodes with deterministic IDs, and `contains`, verified `imports`, and resolvable `calls` edges with call-site location metadata.
8. It returns `repository`, `sha`, ordered `files` analyses, `resolvedRelationships`, and `graph`.

## Repository graph query and context assembly

`src/graph/repository-query.ts` performs direct, read-only lookups over existing node and edge types (`related-files`, `file-symbols`, `file-imports`, `symbol-callers`, `commit-changes`, `commit-symbol-changes`, `commit-affected-symbols`).

`src/graph/repository-context.ts` is a pure one-hop projection over an existing `RepositoryGraph` for file, symbol, and commit targets. Each result section is deduplicated in graph insertion order and truncated by independent configurable limits.

## Repository change-impact analysis

`src/services/change-impact-analysis-service.ts` performs bounded, deterministic change-impact analysis over the in-memory `RepositoryGraph`. For symbol targets, it traverses incoming `calls` edges with cycle-safe breadth-first search and reports direct callers separately from transitive consumers. For file targets, it categorizes direct imports, reverse-import dependents, related files, and heuristic test consumers.

`src/routes/impact.ts` exposes `POST /api/repositories/graph/impact`, validating the request, delegating to `ChangeImpactAnalysisService.analyze`, and verifying consistency via `validateRepositoryContextConsistency` before returning `ChangeImpactAnalysisResult`.

## Evidence consistency validation & compact AI impact context

`src/ai/consistency-validator.ts` treats `RepositoryGraph` as the single source of truth, verifying that every impact node, relationship ID, and call-site citation resolves to data in the graph before any LLM provider is called.

`src/ai/impact-context.ts` projects a validated `ChangeImpactAnalysisResult` into `AiImpactContext`, a consumer-centric representation bounded to fit within `MAX_AI_CONTEXT_BYTES` (16,000 bytes).

## Ask AI orchestration, greetings, and resilient fallback

`src/routes/ai.ts` and `src/services/repository-ai-orchestration-service.ts` handle `POST /api/ai/ask-repository`:

1. **Greeting & small-talk interception**: `classifyQuestion` detects greetings, thanks, and conversational small talk before any GitHub API call or context builder runs. `getGreetingOrSmallTalkResponse` answers immediately using cached `repoFacts` and the selected file path, allowing greetings like `"hello"` to succeed even when GitHub is unreachable.
2. **Question-aware context expansion**: For code questions, `QuestionContextPlanner` prioritizes imports, related files, history, and change impact. `RepositoryContextExpansionService` loads up to a bounded number of additional files from GitHub.
3. **Graceful file-fetch fallback**: If fetching the selected file from GitHub fails on a non-greeting question, the route catches the failure and returns `buildFallbackFactsAnswer` (status `200`, `missingData: ["file_content_unavailable"]`), starting with `"The file content could not be loaded from GitHub."` and summarizing the file's risk score, dependents, owners, and recent commits from the request payload instead of failing the request.
4. **Dual-provider LLM fallback**: `src/ai/provider-factory.ts` supports a primary OpenAI-compatible provider (e.g., Groq) and an automatic fallback provider (e.g., Gemini) with model cooldowns and vision/image support.

## GitHub request configuration, timeouts, and error mapping

All GitHub requests use `src/github/client.ts`:
- **Timeouts**: Every GitHub API call enforces a 15-second timeout (`AbortSignal.timeout(15000)`).
- **Authentication**: Sends `Authorization: Bearer <token>` when `GITHUB_TOKEN` is set in `.env`.
- **Error mapping** (`mapGitHubResponseToError` & `mapGitHubFetchError`):
  - HTTP `404` -> `repo_not_found` (`404`: `"Repository not found. Check the URL, or it may be private."`)
  - HTTP `403` (rate limit) / `429` -> `github_rate_limited` (`429` with `retryAfterSeconds`: `"GitHub rate limit reached. Try again in N minutes. Adding a GITHUB_TOKEN to .env raises the limit."`)
  - HTTP `401` -> `github_auth_failed` (`401`: `"The GitHub token is invalid. Check GITHUB_TOKEN in .env."`)
  - Network error or timeout -> `github_unreachable` (`502`: `"Cannot reach GitHub. Check your internet connection."`)
  - Empty repository or no supported source files -> `repo_empty` (`400`: `"No supported source files found in this repository."`)

## Frontend architecture

The React 19 frontend (`frontend/src/`) connects to `/api` and manages state via Zustand (`frontend/src/store.ts`):
- **Input validation** (`frontend/src/repo-url.ts`): Validates and normalizes `https://github.com/<owner>/<repo>` (including `.git`, trailing slashes, `/tree/...`, `/blob/...`) and `owner/repo` shorthand before calling the API.
- **Analyze resilience** (`frontend/src/components/LandingPage.tsx`): Provides a Cancel button backed by `AbortController` throughout analysis, a 90-second client timeout notice (`"This is taking longer than expected"`), and inline error cards with `"Try again"` and `"Back to home"` actions while preserving previously loaded repository state in the store.
- **Ask AI offline & error handling** (`frontend/src/components/MainPanel.tsx`): Checks `navigator.onLine` before sending requests, displays `"You are offline"` (`"Reconnect to the internet and retry."`) with a Retry button on network failures, maps `github_unreachable` to `"Cannot reach GitHub"`, and renders live rate-limit countdowns.

## Important files

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Process entry point; loads environment configuration and starts the HTTP listener. |
| `src/app.ts` | Express application setup, JSON middleware, and route mounting. |
| `src/repo-url.ts` | Shared GitHub URL and `owner/repo` shorthand validation and normalization. |
| `src/github/client.ts` | GitHub request headers, 15s timeout, rate-limit calculation, and structured error mapping. |
| `src/github/repository-file-client.ts` | Historical file retrieval client with error mapping and timeout support. |
| `src/routes/repositories.ts` | Repository metadata, commits, owners, tree, file content, and SSE/JSON analysis endpoints. |
| `src/routes/ai.ts` | AI Q&A endpoints, greeting interception, SSE streaming, and file-fetch fallback handling. |
| `src/routes/impact.ts` | Deterministic change-impact endpoint with boundary validation. |
| `src/analyzers/registry.ts` | Multi-language analyzer registry (TypeScript, JavaScript, Python, Java, Go, C++). |
| `src/graph/repository-graph.ts` | Deterministic in-memory graph construction for files, symbols, calls, imports, and commits. |
| `src/services/change-impact-analysis-service.ts` | Bounded symbol and file change-impact traversal and evidence linking. |
| `src/services/repository-ai-orchestration-service.ts` | Context expansion, impact integration, AI request preparation, and `buildFallbackFactsAnswer`. |
| `src/ai/answer-service.ts` | Context assembly, consistency validation, greeting responses, and LLM answer generation. |
| `frontend/src/components/LandingPage.tsx` | Hero landing page, URL validation, SSE analysis progress, cancel/timeout, and error cards. |
| `frontend/src/components/MainPanel.tsx` | 2D/3D graph views, file viewer, impact analysis, and Ask AI panel with offline handling. |
| `frontend/public/favicon.svg` | Custom Jade SVG favicon linked in `frontend/index.html`. |
