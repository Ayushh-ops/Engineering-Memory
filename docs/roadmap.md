# Roadmap

This roadmap records only the capabilities currently present in the repository.

## Completed milestones

### Project foundation

- TypeScript project configuration is in place.
- Development, build, and production start scripts are available.
- Compiled output is configured to be written to `dist`.

### HTTP service foundation

- An Express application is configured with JSON request-body parsing.
- The service starts on `PORT` when supplied, otherwise on port `3000`.
- A `GET /api/health` endpoint returns service status and a timestamp.

### GitHub repository metadata lookup

- A `POST /api/repositories` endpoint accepts a GitHub repository URL.
- The endpoint validates HTTPS `github.com/<owner>/<repository>` URLs.
- It retrieves public repository metadata from the GitHub REST API.
- It returns a focused response containing repository identity, owner, description, language, stars, forks, and URL.
- It maps invalid input, a missing repository, GitHub API failures, and connectivity failures to clear HTTP error responses.

### GitHub commit history ingestion

- A `POST /api/repositories/commits` endpoint accepts a GitHub repository URL.
- It retrieves the 10 most recent commits from GitHub's public REST API.
- It uses each returned commit SHA to retrieve that commit's details from GitHub.
- It returns the repository identifier and a simplified commit list containing each commit SHA, message, author name, author date, and changed-file statistics.

### Historical file-content retrieval

- A `POST /api/repositories/file` endpoint accepts a GitHub repository URL, file path, and commit SHA.
- It retrieves the requested file through GitHub's repository contents API with the supplied SHA as the `ref`.
- It decodes the Base64 content returned by GitHub and returns UTF-8 text for that exact historical revision.
- It rejects directory responses and maps invalid input, missing repositories or files, GitHub API failures, and connectivity failures to clear HTTP error responses.

### TypeScript AST analysis

- A `POST /api/analyze` endpoint accepts a non-empty TypeScript source string.
- A focused analyzer module creates a TypeScript Compiler API `SourceFile` and traverses its AST.
- It returns import source paths, classes and their methods, function declarations, and variable declarations as structured JSON rather than exposing the raw AST.
- The analysis is local only; it does not yet retrieve source from GitHub, invoke an LLM, or persist results.

### Historical TypeScript file analysis

- A `POST /api/repositories/analyze-file` endpoint accepts a GitHub repository URL, file path, and commit SHA.
- It reuses historical GitHub file retrieval to obtain and decode exactly the requested file revision.
- It passes the decoded UTF-8 source to the existing TypeScript AST analyzer and returns the repository, path, SHA, and structured analysis.
- It does not analyze a repository broadly, retrieve multiple commits, persist results, or invoke an LLM.

### TypeScript code relationships

- The existing TypeScript analysis result includes structural `relationships` alongside imports, classes, functions, and variables.
- Each import declaration adds an `imports` relationship from `file` to the imported module path.
- Identifier and property-access calls in named functions or class methods add `calls` relationships; class methods are represented as `ClassName.methodName`.
- Relationships do not perform symbol resolution, cross-file import resolution, existence checks, or repository-wide graph construction.

### Controlled repository-level historical analysis

- A `POST /api/repositories/analyze` endpoint accepts a GitHub repository URL, one commit SHA, and a user-supplied list of 1–20 file paths.
- It retrieves every requested file at the same supplied SHA, decodes it through the existing historical-file helper, and analyzes it with the existing TypeScript analyzer.
- It returns one ordered result per requested path, each with focused AST-derived analysis and structural relationships.
- It returns an error rather than a partial response if any requested path cannot be retrieved, and it does not enumerate repository files automatically.
- Analysis is not persisted and does not create a repository-wide graph, use an LLM, or use embeddings.

### Cross-file relative import resolution

- Repository-level analysis resolves supported `./` and `../` imports only when exactly one target exists in the user-supplied file set.
- It normalizes separators and relative segments and tries direct, `.ts`, `.tsx`, `.js`, `.jsx`, and `index` candidates without reading the filesystem.
- It adds ordered, de-duplicated `resolvedRelationships` while preserving each file's original AST-derived import and call relationships.
- It is deliberately not full TypeScript module resolution: packages, aliases, project references, package exports, and undisclosed repository files are not resolved.

### In-memory repository code graph

- Repository-level analysis now returns a structural, in-memory `graph` alongside unchanged `files` and `resolvedRelationships` fields.
- The graph has deterministic, de-duplicated `repository`, `file`, `class`, `function`, and `method` nodes, plus `contains`, verified `imports`, and safely resolvable local `calls` edges.
- It does not persist graph data or model commits and time. It is not a semantic graph: there is no type checking, general symbol resolution, dependency resolution, alias resolution, or runtime inference.

### Temporal repository history graph

- The in-memory graph builder can compose existing GitHub commit data into deterministic `commit:<sha>` nodes containing the SHA, message, author name, and author date.
- It adds de-duplicated `changed` edges from commits only to file nodes already represented in the supplied analysis input; changed paths do not create arbitrary file nodes.
- Structural nodes and `contains`, `imports`, and `calls` edges retain their existing meanings.
- This models commit-to-file history only. It does not explain why a change happened, provide line-level diffs, or identify changed symbols; those are future work.

## Next milestone

### Build on the in-memory temporal repository graph

Future milestones can build on the in-memory graph toward broader codebase context and history. The repository does not yet define a persistence approach, additional GitHub resources, line-level or symbol-level history, or semantic change explanations.
