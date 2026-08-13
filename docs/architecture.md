# Architecture

## Overview

Engineering Memory is currently a small Node.js HTTP service written in TypeScript. It uses Express to expose API endpoints under `/api` and obtains public repository data from the GitHub REST API.

## Express application and routes

`src/app.ts` creates the Express application, enables `express.json()` middleware, and mounts the route modules beneath `/api`.

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| `/api/health` | `GET` | Returns `{ status: "ok", timestamp }` to indicate the service is running. |
| `/api/repositories` | `POST` | Validates a GitHub repository URL, retrieves repository metadata, and returns a reduced API response. |
| `/api/repositories/commits` | `POST` | Validates a GitHub repository URL, retrieves its 10 most recent commits, and returns a reduced commit list. |

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
4. On success, it returns `repository` as `owner/repository` and maps each GitHub commit to its SHA, message, author name, and author date.
5. Invalid URLs return `400`; a missing GitHub repository returns `404`; other GitHub API or network failures return `502`.

## Important files

| File | Responsibility |
| --- | --- |
| `src/index.ts` | Process entry point; selects the port and starts the HTTP listener. |
| `src/app.ts` | Express application setup, JSON middleware, and route mounting. |
| `src/routes/health.ts` | Health-check route. |
| `src/routes/repositories.ts` | GitHub URL parsing, repository metadata and commit-history API requests, response shaping, and error handling. |
| `package.json` | Project metadata, scripts, runtime dependency, and development tooling dependencies. |
| `tsconfig.json` | TypeScript compilation settings, including `src` input and `dist` output directories. |
| `.gitignore` | Excludes dependency installation, compiled output, and environment files from Git. |

## Runtime and build layout

Source files live in `src`. TypeScript compiles them to `dist`; the production start script runs `dist/index.js`. The development script uses `tsx` to watch and execute `src/index.ts` directly.
