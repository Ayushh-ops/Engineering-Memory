# Roadmap

This roadmap records the capabilities implemented in the repository.

## Completed milestones

### Project & HTTP service foundation

- Strict TypeScript configuration across backend and frontend workspaces.
- Express HTTP server with modular route boundaries, CORS support, and a 15 MB JSON body limit for graph operations.
- `GET /api/health` endpoint returning service status and timestamp.

### GitHub repository metadata, tree discovery, and historical retrieval

- `POST /api/repositories` validates GitHub repository URLs and retrieves repository metadata (`owner`, `description`, `language`, `stars`, `forks`, `url`).
- `POST /api/repositories/tree` discovers the default branch, resolves the latest commit SHA, traverses the recursive Git tree, and filters up to 60 prioritized source files (prioritizing `src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/`, `core/`, `server/` and skipping `node_modules/`, `dist/`, `build/`, `vendor/`, tests, and lockfiles).
- `POST /api/repositories/commits` retrieves recent commit history with changed-file statistics.
- `POST /api/repositories/owners` computes per-file author ownership percentages and recent commit summaries across repository history.
- `POST /api/repositories/file` and `POST /api/file` retrieve and decode UTF-8 source files from GitHub at an exact commit SHA or branch ref.

### Multi-language AST and structural source analysis

- `POST /api/analyze` and `POST /api/repositories/analyze-file` parse source code into structured imports, classes, methods, functions, variables, and call/import relationships.
- Multi-language analyzer registry (`src/analyzers/registry.ts`) supporting:
  - TypeScript and JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`) via the TypeScript Compiler API
  - Python (`.py`)
  - Go (`.go`)
  - Java (`.java`)
  - C and C++ (`.c`, `.cc`, `.cpp`, `.h`, `.hpp`)

### Cross-file import resolution & in-memory repository graph

- `POST /api/repositories/analyze` analyzes up to 60 repository files concurrently at a given SHA, supporting both JSON responses and Server-Sent Events (SSE) progress streaming (`?stream=true`).
- Cross-file relative and module import resolution produces ordered, de-duplicated `resolvedRelationships`.
- Deterministic in-memory `RepositoryGraph` construction with `repository`, `file`, `class`, `function`, `method`, `commit`, and `symbol-change` nodes, connected by `contains`, `imports`, `calls`, `changed`, `in-file`, and `affects` edges.
- `POST /api/repositories/analyze-history` enriches the graph with commit-to-file history and structural `symbol-change` nodes across commits.

### Read-only graph queries & bounded context assembly

- `POST /api/repositories/graph/query` executes typed read-only queries over a caller-supplied graph (related files, file symbols, imports, symbol callers, commit changes, symbol changes, affected symbols).
- `POST /api/repositories/graph/context` deterministically assembles bounded one-hop context (`files`, `symbols`, `imports`, `callers`, `commits`, `symbolChanges`) for file, symbol, or commit targets.

### Deterministic change-impact analysis & batch risk scoring

- `ChangeImpactAnalysisService` traverses direct and transitive dependents across file imports and symbol call sites with source-line evidence.
- `POST /api/repositories/graph/impact` validates graph consistency (`validateRepositoryContextConsistency`) and returns the full `ChangeImpactAnalysisResult`.
- `POST /api/impact/batch` computes blast-radius metrics (`directDependents`, `transitiveDependents`, `impactedSymbols`, `risk` level) for up to 200 files in a single request.
- Compact AI impact projection (`src/ai/impact-context.ts`) normalizes impact chains into a budget-bounded, consumer-centric representation for LLM prompts.

### Question-aware Ask AI with streaming and dual-provider fallback

- `POST /api/ai/ask` provides graph-validated deterministic context assembly and structured LLM answers with citations.
- `POST /api/ai/ask-repository` powers the interactive repository assistant:
  - Question classification (`greeting`, `Quick`, `Symbol / file`, `Impact`, `History`, `Architecture`, `General`) and tailored context budgets.
  - Greeting and small-talk fast-path that answers from cached `repoFacts` and file path without contacting GitHub.
  - Resilient file-fetch fallback that answers from existing repository facts with a single-sentence note if GitHub file retrieval fails.
  - Real-time SSE token streaming (`meta`, `token`, `done` events).
  - Automatic fallback from primary OpenAI-compatible provider (`LLM_API_KEY`, e.g. Groq) to secondary Gemini provider (`LLM_FALLBACK_API_KEY`) with runtime model discovery.

### Interactive web application (Frontend)

- React 19 + TypeScript + Tailwind CSS + Vite application with Jade design tokens.
- Interactive 2D dependency graph (`@xyflow/react` + `dagre`) and 3D force-directed graph (`three`).
- File tree explorer, symbol & dependency inspector, blast-radius impact view, commit history timeline, ownership / bus-factor breakdown, and syntax-highlighted code viewer (`prism-react-renderer`).
- Integrated Ask AI drawer with conversation history, quick prompts, evidence badges, and retry timers.
- Local workspace session persistence (`localStorage`) and recently analyzed repositories list.

### Release polish & resilience

- Client-side repository URL validation (`https://github.com/owner/repo`, `.git`, `/tree/...`, `/blob/...`, and `owner/repo` shorthand) with inline feedback before opening the analysis view.
- 15-second timeouts on all GitHub API requests and structured error codes (`repo_not_found`, `github_rate_limited`, `github_auth_failed`, `github_unreachable`, `repo_empty`).
- Resilient analysis progress UI with a 90-second slow-warning message, `AbortController` cancellation, error cards with "Try again" and "Back to home" actions, and non-destructive store state.
- Offline detection (`navigator.onLine` and network error handling) in Ask AI with "You are offline" state and Retry action.
- Custom SVG favicon (`frontend/public/favicon.svg`), page metadata, Open Graph tags, and setup/troubleshooting documentation in `README.md`.

## Future directions

- Support for authenticated private repository workflows in the UI.
- Optional persistent graph caching for large monorepos.
- Deeper cross-file type-checked call resolution for dynamically typed languages.
