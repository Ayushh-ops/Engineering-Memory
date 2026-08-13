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
- It returns the repository identifier and a simplified commit list containing each commit SHA, message, author name, and author date.

## Next milestone

### Build on the commit-history foundation

The next milestone is to extend the service beyond the current metadata and commit-history lookups toward the stated Engineering Memory purpose: codebase context and history. The repository does not yet define the required data model, persistence approach, additional GitHub resources, or API contract, so those details remain to be designed.
