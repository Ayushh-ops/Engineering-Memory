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
| `/api/repositories/analyze` | `POST` | Retrieves and analyzes up to 20 supplied files at one supplied SHA, returning one structured result per path. |
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
5. It calls `analyzeTypeScript` once for each decoded file and returns `repository`, the supplied `sha`, and ordered file entries containing each requested `path` and its structured `analysis`.

The endpoint does not enumerate or automatically analyze a repository, process more than one commit, expose source or raw AST data, or persist analysis. Each file's relationships remain limited to the existing structural, single-file analysis.

## GitHub repository metadata flow

1. A client sends `POST /api/repositories` with a JSON body containing `url`.
2. The repository route accepts only an HTTPS URL for `github.com` with exactly an owner and repository path.
3. It removes an optional `.git` suffix from the repository name.
4. It calls `https://api.github.com/repos/{owner}/{repository}` using Node's built-in `fetch`, with GitHub's JSON media-type `Accept` header.
5. On success, it returns selected metadata: name, full name, owner, description, language, star count, fork count, and HTML URL.
6. Invalid URLs return `400`; a missing GitHub repository returns `404`; other GitHub API or network failures return `502`.

The current integration uses the public GitHub API without authentication. No repository metadata is stored locally.

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
| `package.json` | Project metadata, scripts, runtime dependency, and development tooling dependencies. |
| `tsconfig.json` | TypeScript compilation settings, including `src` input and `dist` output directories. |
| `.gitignore` | Excludes dependency installation, compiled output, and environment files from Git. |

## Runtime and build layout

Source files live in `src`. TypeScript compiles them to `dist`; the production start script runs `dist/index.js`. The development script uses `tsx` to watch and execute `src/index.ts` directly.
