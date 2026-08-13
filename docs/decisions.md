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

## Ignoring `node_modules` in Git

`node_modules/` is ignored by Git because it is generated from the dependency manifests and lockfile during installation. Tracking it would add a large, platform-dependent dependency tree to source control; `package.json` and `package-lock.json` define the dependencies needed to reproduce it.
