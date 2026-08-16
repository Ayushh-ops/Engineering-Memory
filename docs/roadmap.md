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

## Next milestone

### Build on historical file analysis

Future milestones can build on single-file historical analysis toward broader codebase context and history. The repository does not yet define a data model, persistence approach, additional GitHub resources, or multi-file analysis contract.
