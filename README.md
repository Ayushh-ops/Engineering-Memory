# Engineering Memory

Engineering Memory is a TypeScript and Express backend for retrieving public GitHub repository metadata.

## Current capabilities

- `GET /api/health` returns a health status and timestamp.
- `POST /api/repositories` accepts a GitHub repository URL and returns selected public metadata.
- `POST /api/repositories/commits` accepts a GitHub repository URL and returns its 10 most recent commits.

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

The endpoint returns the repository identifier and commit SHA, message, author name, and author date for the 10 most recent commits.

## Documentation

- [Roadmap](docs/roadmap.md)
- [Architecture](docs/architecture.md)
- [Technical decisions](docs/decisions.md)
