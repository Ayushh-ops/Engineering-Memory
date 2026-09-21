# Architecture

## Overview

Engineering Memory is currently a small Node.js HTTP service written in TypeScript. It uses Express to expose API endpoints under `/api` and obtains public repository data from the GitHub REST API.

## Express application and routes

`src/app.ts` creates the Express application, enables `express.json()` middleware, and mounts the route modules beneath `/api`.

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| `/api/health` | `GET` | Returns `{ status: "ok", timestamp }` to indicate the service is running. |
| `/api/repositories` | `POST` | Validates a GitHub repository URL, retrieves repository metadata, and returns a reduced API response. |
| `/api/repositories/commits` | `POST` | Validates a GitHub repository URL, retrieves its 10 most recent commits and their changed-file statistics, and returns a reduced commit list. |
| `/api/repositories/file` | `POST` | Validates a GitHub repository URL, file path, and commit SHA, then retrieves UTF-8 file content at that revision. |
| `/api/repositories/analyze-file` | `POST` | Retrieves one historical file at a supplied SHA and returns the existing TypeScript analyzer's structured result. |
| `/api/repositories/analyze` | `POST` | Retrieves and analyzes up to 20 supplied files at one supplied SHA, returning one structured result per path, resolved relative-import links, and an in-memory structural graph. |
| `/api/repositories/analyze-history` | `POST` | Retrieves a commit and its first-parent comparison for up to 20 supplied files, returning structural TypeScript symbol changes and an additive historical graph. |
| `/api/repositories/graph/query` | `POST` | Executes a validated, read-only query against a caller-supplied in-memory repository graph. |
| `/api/repositories/graph/context` | `POST` | Assembles bounded, deterministic one-hop context for a target in a caller-supplied graph. |
| `/api/analyze` | `POST` | Validates a TypeScript source string and returns focused AST-derived structure. |

## TypeScript AST analysis flow

1. A client sends `POST /api/analyze` with a non-empty `code` string.
2. `src/routes/analysis.ts` validates the request and calls the analyzer without handling AST details itself.
3. `src/analyzers/typescript.ts` uses `ts.createSourceFile` from the TypeScript Compiler API to parse the source as TypeScript.
4. It traverses the tree with `ts.forEachChild`, detecting import declarations, class declarations and their method members, function declarations, variable declarations, and call expressions.
5. It returns only structured values: import source paths; class names with method names and parameter names; function names with parameter names; variable names; and structural relationships. Every import adds an `imports` relationship from `file` to the module path. Identifier and property-access calls in a named function or method add `calls` relationships, with class methods identified as `ClassName.methodName`. No raw AST is exposed.

Relationship extraction is structural only: it does not resolve symbols, verify that called functions exist, resolve imports across files, or build a repository-wide graph. This endpoint is local-only. It does not call GitHub, persist analysis results, or use an LLM.

## Historical TypeScript file-analysis flow

1. A client sends `POST /api/repositories/analyze-file` with a repository URL, file path, and commit SHA.
2. The repository route applies the same URL, path, and SHA validation used for historical file retrieval.
3. The shared historical-file helper calls GitHub's contents API with the SHA as `ref`, rejects directories, and decodes the Base64 file response as UTF-8.
4. The route passes that decoded source string directly to `analyzeTypeScript` in `src/analyzers/typescript.ts`.
5. It returns the repository identifier, supplied path and SHA, and the analyzer's structured `analysis` result, including structural import and call relationships.

GitHub fetching remains in the repository route and AST traversal remains exclusively in the analyzer. The endpoint retrieves and analyzes exactly one supplied file revision; it does not enumerate repository files or commits.

## Repository-level historical TypeScript analysis flow

1. A client sends `POST /api/repositories/analyze` with a repository URL, a non-empty SHA, and 1–20 non-empty file paths.
2. The repository route validates the URL with the existing parser and validates the SHA and paths before contacting GitHub.
3. It retrieves every requested path concurrently through the shared historical-file helper, which uses the same supplied SHA as the contents API `ref`, rejects directories, and decodes Base64 content as UTF-8.
4. The route checks retrieval outcomes in requested-path order, returning an error instead of partial success if any requested file cannot be retrieved.
5. It calls `analyzeTypeScript` once for each decoded file, preserving the resulting per-file analysis unchanged.
6. A focused repository-level resolver walks the AST-derived import relationships in requested-file and relationship order. For `./` and `../` imports only, it normalizes separators and relative segments, then compares extensionless, `.ts`, `.tsx`, `.js`, `.jsx`, and `index` candidates exclusively against the requested path set.
7. It passes the existing analyses and resolved import relationships to `src/graph/repository-graph.ts`, which does not parse source or resolve imports. It creates ordered, de-duplicated repository, file, class, function, and method nodes with deterministic IDs, and `contains`, verified `imports`, and safely resolvable local `calls` edges. Resolved call edges have deterministic relationship IDs and preserve every call-site occurrence captured by the AST analyzer, including its source path, range, and exact expression; repeated calls between the same symbols are merged into one topology edge with multiple call-site records. The same builder accepts GitHub commit data supplied by a caller and composes `commit:<sha>` nodes plus `changed` edges only when a changed filename exactly matches an already-supplied file path; it never invents file nodes from commit history.
8. It returns `repository`, the supplied `sha`, ordered file entries containing each requested `path` and its structured `analysis`, ordered, de-duplicated `resolvedRelationships`, and `graph`. A target is emitted only when exactly one supplied path matches; unmatched or ambiguous imports remain absent from this repository-level list while their original AST-derived import relationship remains in the file analysis.

The resolver and graph builder do not access the filesystem or implement full TypeScript module resolution. The graph uses only resolved relative imports and local structural calls whose endpoints are known in the same file; call-site metadata preserves syntax locations but does not add cross-file semantic resolution or complete impact paths. When supplied with existing commit-history data, it also represents commits and known-file changes, but does not infer why code changed or attribute changes to symbols. It does not resolve packages, aliases, project references, package exports, or files not explicitly supplied. The graph is in-memory only. The endpoint does not enumerate or automatically analyze a repository, fetch commit history, expose source or raw AST data, or persist analysis.

The historical graph extends this model with `symbol-change` nodes. Each node represents one applicable added, removed, or modified class, function, or method for the requested commit and file. A `changed` edge connects the commit to the change event, an `in-file` edge connects the event to the file, and an `affects` edge connects it to an existing structural symbol when available. Removed symbols therefore retain historical event and file relationships without creating current structural symbol nodes. Existing `/api/repositories/analyze` graph behavior and IDs are unchanged.

## Repository graph query flow

1. A client sends `POST /api/repositories/graph/query` with a graph payload and one typed query.
2. `src/routes/repositories.ts` validates the graph's node and edge arrays and the query discriminator and identifiers.
3. `src/graph/repository-query.ts` performs direct lookups over existing node and edge types. It does not rebuild, mutate, persist, resolve, or expand the graph transitively.
4. Results are returned in graph node order, with duplicate node IDs removed after their first occurrence. Unknown files, symbols, and commits return empty arrays.

The supported queries are related files, symbols in a file, imported files, callers of a symbol, files and symbol changes for a commit, symbol changes for a commit, and structural symbols affected by a commit. The endpoint only answers questions about the explicitly supplied graph; it does not retrieve GitHub data or discover additional files.

## Repository graph context assembly

`src/graph/repository-context.ts` is a pure projection over an existing `RepositoryGraph`. It reuses `queryRepositoryGraph` for file symbols, direct imports, symbol callers, commit changes, and affected symbols. It adds no node or edge types and does not change graph identifiers or query behavior.

The context endpoint supports file, symbol, and commit targets. File context includes the target and directly imported files, symbols in the target file, direct callers, directly changing commits, and same-file symbol changes. Symbol context includes its containing file, the target symbol, direct callers, directly changing commits, and symbol changes in that file. Commit context includes the commit, directly changed known files, affected structural symbols, and directly changed symbol-change events. Imports are limited to edges originating from included files.

Traversal is strictly one-hop/direct. Each result section is deduplicated in graph insertion order and truncated by independent limits. Defaults are 8 files, 40 symbols, 20 callers, 10 commits, and 40 symbol changes. Maximums are 50 files, 200 symbols, 100 callers, 50 commits, and 200 symbol changes. Removed symbols remain historical `symbol-change` events only; the assembler never creates structural nodes for them. The endpoint accepts the graph in the request and performs no GitHub access, persistence, crawling, or semantic ranking.

## Repository change-impact analysis

`src/services/change-impact-analysis-service.ts` performs bounded, deterministic change-impact analysis over the existing in-memory `RepositoryGraph`. For symbol targets, it traverses incoming `calls` edges with breadth-first search and reports direct callers separately from transitive consumers. Traversal is cycle-safe; `maxDepth` and `maxResults` bound the analysis, and `truncated` indicates that configured bounds prevented complete traversal.

`ChangeImpactAnalysisResult` is the deterministic semantic impact contract. Its bounded `impactNodes` collection is the canonical lookup for nodes referenced by emitted paths, and `targetNodeId` identifies the successful symbol target without exposing raw graph nodes. Paths are ordered in impact direction (target to caller to higher-level consumer), while the underlying graph relationship remains caller-to-callee. Each path relationship explicitly identifies `type: "calls"`, its graph relationship ID, evidence availability, and available call-site evidence IDs, which resolve against the result's bounded `callSiteEvidence` collection. This preserves the distinction between a deterministic relationship fact, the source call-site supporting it, optional declaration context in `sourceEvidence`, and downstream AI interpretation. Flattened caller/dependency fields remain compatibility summaries; paths and `impactNodes` are the canonical semantic records for visualization consumers. Legacy edges without IDs or call-site data can still contribute topology, but their paths explicitly retain the limitation that relationship source evidence is unavailable. These paths are deterministic and do not represent complete runtime impact, all possible paths, or guaranteed breakage. A future frontend consumes this result without accessing `RepositoryGraph`; the AI remains downstream interpretation only.

For file targets, direct imports, reverse-import dependents, and related files remain separate relationship categories. Test consumers are identified heuristically from path conventions such as `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `test`, `tests`, and `__tests__`. This classification does not prove that a test exercises the target.

Source evidence can be selected through the existing `src/services/repository-source-evidence-service.ts`. Evidence uses only already-supplied files and remains bounded. The service does not fetch files, enumerate repositories, execute code, or use an LLM. M24 is invoked in repository AI Q&A only when `QuestionContextPlanner` identifies an `impact` context, and its structured result is projected into a bounded, deterministic compact form before it is serialized into the AI context. The two evidence sources remain mutually exclusive: when the impact result already carries declaration evidence, the standalone selection is omitted so the same snippets are never serialized twice.

The results describe statically observed relationships and potential review candidates. They do not claim guaranteed breakage, safety of removal, complete usage discovery, or runtime impact.

## Evidence consistency validation

`src/ai/answer-service.ts` validates every assembled AI context before it is sent to a provider. After `assembleRepositoryContext` succeeds and before `buildAiContext` runs, the service calls `validateRepositoryContextConsistency` from `src/ai/consistency-validator.ts` with the repository graph, the optional source evidence, and the optional change-impact result.

The validator treats `RepositoryGraph` as the source of truth. It requires that `impact.targetNodeId`, every path node ID, every path relationship ID, every relationship `type`/`from`/`to`, every path `callSiteId`, and every `callSiteEvidence` entry - including its file, line, column, and expression fields - resolve to data that already exists in the supplied graph. Source evidence must resolve to a graph symbol at a graph file path. Impact call-site evidence must also be reachable through the impact path chain - `relationshipId` to graph edge to `edge.callSites` to derived `callSiteId` - so a real call site elsewhere in the graph cannot validate an impact citation. Legacy `calls` edges without an explicit ID are matched through the same deterministic synthesized relationship ID that the impact service derives from `type`, `from`, and `to`, so graphs without edge IDs remain valid.

`impact.status === "missing"` and `impact.status === "ambiguous"` are existing domain outcomes, not contradictions, so the validator returns `ok` for them. Any deterministic contradiction returns `invalid` with stable, ordered failure codes. When the result is `invalid`, the answer service returns a controlled `invalid_graph` error carrying those codes in `missingData` and never calls the LLM provider. The validator is a pure function: it performs no I/O, no mutation of its inputs, no caching, no graph indexing, no embeddings, and no open-ended semantic resolution.

## Compact AI impact context

`src/ai/impact-context.ts` projects a validated `ChangeImpactAnalysisResult` into `AiImpactContext`, the only impact representation serialized into the LLM payload. The full result remains unchanged as the backend and future frontend source of truth. The projection is derived per request, is never persisted or returned over HTTP, and constructs no identifiers of its own: it joins against the relationship, path, node, and call-site identifiers already present in the validated result.

The compact form is consumer centric. `consumers[]` lists every affected symbol with its depth, relationship, and test classification; `consumer.chain[]` indexes `relationships[]`; and each `relationships[]` entry carries the graph relationship id together with its own call sites. Path node sequences are recoverable from the ordered chain, so `paths`, `impactNodes`, and the separate `directCallers`, `transitiveConsumers`, `tests`, and `reviewCandidates` collections are not repeated. Evidence is nested inside the relationship that cites it and is never sampled, and the encoded call-site identifier is omitted because the relationship id plus the call-site span already determine it.

`AiAnswerService` validates the full result first. `buildAiContext` then measures the non-impact payload and passes the remaining budget to the projection. Detail is preferred whenever it fits; when the budget binds, whole consumers lose their chain as a unit and the omission is reported through `compaction`, `totals`, and a generated limitation, so the model is always told that it is reading a bounded view. No string is ever truncated and evidence is never removed to save space. `MAX_AI_CONTEXT_BYTES` remains 16,000 and is still re-checked on the assembled context; if the payload cannot fit even at the consumer-only floor, the answer service returns a controlled `insufficient_context` result with `context_too_large` instead of failing the request.
## GitHub repository metadata flow

1. A client sends `POST /api/repositories` with a JSON body containing `url`.
2. The repository route accepts only an HTTPS URL for `github.com` with exactly an owner and repository path.
3. It removes an optional `.git` suffix from the repository name.
4. It calls `https://api.github.com/repos/{owner}/{repository}` using Node's built-in `fetch`, with GitHub's JSON media-type `Accept` header.
5. On success, it returns selected metadata: name, full name, owner, description, language, star count, fork count, and HTML URL.
6. Invalid URLs return `400`; a missing GitHub repository returns `404`; other GitHub API or network failures return `502`.

The current integration uses the public GitHub API without authentication. No repository metadata is stored locally.

## GitHub request configuration and rate limits

All GitHub requests use the request options from `src/github/client.ts`. The helper always supplies GitHub's JSON `Accept` header and adds `Authorization: Bearer <token>` only when the trimmed `GITHUB_TOKEN` environment variable is non-empty. Without that variable, requests retain unauthenticated public-API behavior. The application does not load `.env` files itself; the variable must be supplied by the process environment or a development environment manager.

The helper identifies HTTP `429` responses and HTTP `403` responses with `x-ratelimit-remaining: 0` as rate-limit failures. Routes return HTTP `429` with a clear error and, when GitHub supplies a valid reset timestamp, its UTC retry time. No automatic retries are performed. Tokens and sensitive headers are not returned or included in errors.

## GitHub commit-history flow

1. A client sends `POST /api/repositories/commits` with a JSON body containing `url`.
2. The route validates and parses the URL using the same GitHub URL parser as the repository metadata endpoint.
3. It calls `https://api.github.com/repos/{owner}/{repository}/commits?per_page=10` using Node's built-in `fetch`.
4. For each SHA in that response, it calls `https://api.github.com/repos/{owner}/{repository}/commits/{sha}` to retrieve commit details.
5. On success, it returns `repository` as `owner/repository` and maps each commit to its SHA, message, author name, author date, and each changed file's filename, status, additions, deletions, and changes.
6. Invalid URLs return `400`; a missing GitHub repository returns `404`; other GitHub API or network failures return `502`.

## Historical file-content flow

1. A client sends `POST /api/repositories/file` with `url`, `path`, and `sha` in its JSON body.
2. The route validates the repository URL with the shared parser and requires non-empty string values for both the path and SHA.
3. It calls `https://api.github.com/repos/{owner}/{repository}/contents/{path}?ref={sha}` using Node's built-in `fetch`. The supplied SHA is used directly as `ref`, which selects the requested commit instead of the default branch.
4. It rejects directory responses, decodes a file response's Base64 content as UTF-8 text, and returns the repository identifier, requested path, SHA, and decoded content.
5. Invalid input and directory paths return `400`; a missing repository or file returns `404`; other GitHub API or network failures return `502`.

## Important files

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Process entry point; selects the port and starts the HTTP listener. |
| `src/app.ts` | Express application setup, JSON middleware, and route mounting. |
| `src/routes/health.ts` | Health-check route. |
| `src/routes/analysis.ts` | Validates AST-analysis requests and returns analyzer results. |
| `src/routes/repositories.ts` | GitHub URL parsing; repository metadata, commit-history, historical-file retrieval, and single- and controlled multi-file analysis composition; response shaping; and error handling. |
| `src/analyzers/typescript.ts` | TypeScript Compiler API source parsing, AST traversal, and focused analysis result shaping. |
| `src/resolvers/relative-imports.ts` | Repository-level, supplied-path-only resolution of supported relative AST import relationships. |
| `src/graph/repository-graph.ts` | Transformation of existing analysis, resolved imports, and caller-supplied commit history into an in-memory repository graph. |
| `src/graph/repository-context.ts` | Pure, bounded, one-hop context assembly over an existing repository graph. |
| `src/services/change-impact-analysis-service.ts` | Bounded, deterministic symbol and file change-impact analysis and review-candidate selection over the existing graph. |
| `src/services/question-context-planner.ts` | Question-aware prioritization of source, graph, history, and impact context types. |
| `src/services/repository-ai-orchestration-service.ts` | Controlled repository file loading, analysis, context planning, M24 impact integration, and AI request composition. |
| `src/services/repository-source-evidence-service.ts` | Bounded source-snippet selection from already-fetched files for graph and impact context. |
| `src/ai/answer-service.ts` | Repository context assembly, evidence consistency validation, and LLM answer composition. |
| `src/ai/consistency-validator.ts` | Pure, deterministic validation of impact and source evidence against the repository graph before provider calls. |
| `src/ai/impact-context.ts` | Bounded, deterministic projection of a validated change-impact result into the compact AI context representation. |
| `src/github/client.ts` | Shared GitHub request headers and rate-limit response classification. |
| `package.json` | Project metadata, scripts, runtime dependency, and development tooling dependencies. |
| `tsconfig.json` | TypeScript compilation settings, including `src` input and `dist` output directories. |
| `.gitignore` | Excludes dependency installation, compiled output, and environment files from Git. |

## Runtime and build layout

Source files live in `src`. TypeScript compiles them to `dist`; the production start script runs `dist/index.js`. The development script uses `tsx` to watch and execute `src/index.ts` directly.
