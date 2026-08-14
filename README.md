# Engineering Memory

Engineering Memory is a TypeScript and Express backend for retrieving public GitHub repository metadata.

## Current capabilities

- `GET /api/health` returns a health status and timestamp.
- `POST /api/repositories` accepts a GitHub repository URL and returns selected public metadata.
- `POST /api/repositories/commits` accepts a GitHub repository URL and returns its 10 most recent commits with changed-file statistics.
- `POST /api/repositories/file` accepts a GitHub repository URL, path, and commit SHA and returns the file's UTF-8 content at that revision.

## Run locally

```bash
npm run dev
```

The service listens on port `3000` by default. Set `PORT` to use a different port.

## API

### Health check

```http
GET /api/health
```

### Repository metadata

```http
POST /api/repositories
Content-Type: application/json

{
  "url": "https://github.com/owner/repository"
}
```

The endpoint retrieves public metadata from the GitHub API. It does not currently use GitHub authentication or store repository data.

### Recent commits

```http
POST /api/repositories/commits
Content-Type: application/json

{
  "url": "https://github.com/vercel/next.js"
}
```

The endpoint returns the repository identifier and commit SHA, message, author name, author date, and changed-file statistics for the 10 most recent commits.

### Historical file content

```http
POST /api/repositories/file
Content-Type: application/json

{
  "url": "https://github.com/vercel/next.js",
  "path": "package.json",
  "sha": "<commit-sha>"
}
```

The supplied SHA is sent to GitHub as the contents API `ref`, so the endpoint returns the file at that exact commit rather than the repository's current default branch.

## Documentation

- [Roadmap](docs/roadmap.md)
- [Architecture](docs/architecture.md)
- [Technical decisions](docs/decisions.md)
