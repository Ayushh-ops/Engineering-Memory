# Technical decisions

This document describes decisions evidenced by the current repository.

## TypeScript

The application is written in TypeScript. It uses strict compiler settings and types Express application objects, requests, responses, and the GitHub API data used by the repository endpoint. This provides compile-time checking for the server code and its external-response mapping.

## Express

Express is the HTTP framework. It provides application setup, JSON parsing, routers, route handlers, and HTTP responses. Routes are separated into modules and mounted by the application under the `/api` prefix.

## Node's built-in `fetch` instead of Axios

The GitHub integration uses the global `fetch` API supplied by Node.js. Axios is not listed as a dependency. This keeps the current service's HTTP-client needs within the Node runtime and avoids adding another package for a single external API request.

## Public GitHub API without authentication for the first version

The repository lookup calls GitHub's public `repos/{owner}/{repository}` endpoint without an authorization header. The first version therefore supports publicly accessible repository metadata and does not require token configuration or credential storage.

## Optional GitHub authentication without automatic retries

GitHub authentication is opt-in through the `GITHUB_TOKEN` process environment variable. A shared request-options helper adds a Bearer authorization header only when a non-empty token is present, preserving unauthenticated behavior otherwise. Rate-limit responses are surfaced as controlled errors rather than triggering automatic retries, avoiding request amplification and keeping the service's behavior predictable. Tokens are not returned, logged, or included in error messages.

## Ignoring `node_modules` in Git

`node_modules/` is ignored by Git because it is generated from the dependency manifests and lockfile during installation. Tracking it would add a large, platform-dependent dependency tree to source control; `package.json` and `package-lock.json` define the dependencies needed to reproduce it.

## Querying supplied graphs without persistence

Repository graph queries operate on a graph supplied in the request rather than introducing storage or a graph identifier. This preserves the current bounded, request-scoped architecture and makes the query layer a pure read-only projection over existing node and edge semantics. Queries are direct only; they do not crawl repositories, resolve additional modules, or traverse dependencies transitively.

## Deterministic bounded context assembly

Milestone 15 context assembly is a pure module over an existing `RepositoryGraph`. It composes the existing direct query functions instead of defining another graph-resolution model. It supports file, symbol, and commit targets and performs only fixed one-hop selection. Results preserve graph insertion order, deduplicate node IDs, and apply independent configurable limits with hard maximums. The additive context endpoint accepts the graph in the request and does not contact GitHub or introduce persistence, AI, embeddings, or vector search.

Historical context uses existing commit and `symbol-change` nodes. Removed symbols are historical events only because the graph intentionally does not create structural nodes for removed declarations. Missing and ambiguous target identities are reported as client errors at the HTTP boundary.


## Rejecting inconsistent AI context before provider calls

The repository graph is the single source of truth for AI context. `validateRepositoryContextConsistency` is a pure, deterministic check that runs in `AiAnswerService` after repository context assembly and before `buildAiContext`, and any deterministic contradiction (`status: "invalid"`) stops the request with a controlled `invalid_graph` error instead of sending unverifiable facts to a provider. Failure codes are stable and ordered so results remain reproducible and testable.

The check deliberately avoids LLM calls, GitHub access, caching, mutation, graph indexing, embeddings, and cross-file semantic resolution. It only re-derives facts the graph already contains, which keeps `RepositoryGraph`, `ChangeImpactAnalysisService`, `RepositorySourceEvidenceService`, and existing public contracts unchanged. Call-site evidence must be reachable through an impact path relationship (`relationshipId` to graph edge to `edge.callSites` to a derived `callSiteId`), so a real call site that exists elsewhere in the graph cannot justify an impact citation. Legacy `calls` edges without explicit IDs stay valid because validation reuses the same synthesized relationship ID that the impact service emits, and existing call-site evidence IDs continue to resolve. Missing and ambiguous impact targets keep their existing domain behavior and are never reported as consistency failures.

Validation is fail-closed, so a caller that supplies impact or evidence data must supply data derived from the same graph. Hand-built facts that contradict the graph are rejected before the provider is called.
