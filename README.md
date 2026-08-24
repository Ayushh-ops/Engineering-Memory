# Engineering Memory

Engineering Memory is a TypeScript and Express backend for retrieving public GitHub repository metadata.

## Current capabilities

- `GET /api/health` returns a health status and timestamp.
- `POST /api/repositories` accepts a GitHub repository URL and returns selected public metadata.
- `POST /api/repositories/commits` accepts a GitHub repository URL and returns its 10 most recent commits with changed-file statistics.
- `POST /api/repositories/file` accepts a GitHub repository URL, path, and commit SHA and returns the file's UTF-8 content at that revision.
- `POST /api/repositories/analyze-file` retrieves one historical TypeScript file and returns its AST-derived structure.
- `POST /api/repositories/analyze` retrieves and analyzes up to 20 user-selected historical files from one commit, resolves supported relative imports, and builds an in-memory structural code graph.
- `POST /api/analyze` accepts TypeScript source code and returns focused AST-derived code structure.

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

### TypeScript analysis

```http
POST /api/analyze
Content-Type: application/json

{
  "code": "const x = 10;"
}
```

The endpoint returns import sources, classes and their methods, function declarations, variable declarations, and structural code relationships. Each import produces an `imports` relationship from `file` to its module path. Calls made inside a named function or class method produce `calls` relationships; class methods use `ClassName.methodName` as the source. It performs local analysis only and does not contact GitHub or store data.

### Historical TypeScript file analysis

```http
POST /api/repositories/analyze-file
Content-Type: application/json

{
  "url": "https://github.com/vercel/next.js",
  "path": "packages/example/file.ts",
  "sha": "<commit-sha>"
}
```

The endpoint retrieves and decodes exactly the requested file at the supplied SHA, then passes its UTF-8 source to the existing TypeScript analyzer. It returns `repository`, `path`, `sha`, and `analysis`, including structural import and call relationships; it does not analyze any other files or commits.

### Repository-level historical TypeScript analysis

```http
POST /api/repositories/analyze
Content-Type: application/json

{
  "url": "https://github.com/vercel/next.js",
  "sha": "<commit-sha>",
  "paths": [
    "packages/example/auth.ts",
    "packages/example/user.ts"
  ]
}
```

The endpoint analyzes only the supplied paths (between 1 and 20) and retrieves every file using the same supplied commit SHA. Its response contains `repository`, `sha`, a `files` array, `resolvedRelationships`, and `graph`. Each file entry preserves the requested `path` and contains that file's focused `analysis` result; the original AST-derived import relationship is retained there. `resolvedRelationships` adds unambiguous links between supplied files for relative imports beginning with `./` or `../`, including `.ts`, `.tsx`, `.js`, `.jsx`, and supported `index` files.

`graph` is an in-memory graph with deterministic node IDs. Its structural portion has `repository`, `file`, `class`, `function`, and `method` nodes plus `contains`, `imports`, and safely resolvable local `calls` edges. The graph builder can additionally compose GitHub commit data into `commit` nodes (`commit:<sha>`) and `changed` edges to already-known `file` nodes. A changed path that is not among the analyzed graph inputs is deliberately not made into a file node or edge. IDs use forms such as `repository:owner/repository`, `file:src/auth.ts`, `class:src/user.ts:UserService`, `function:src/auth.ts:getUser`, and `method:src/user.ts:UserService.getUser`; delimiter characters inside components are encoded to prevent collisions. Import edges come only from verified `resolvedRelationships`. A call edge is emitted only when both endpoints are unambiguously declared in the same analyzed file; unresolved and property calls are not guessed. The graph is not persisted and is structural rather than semantic: it does not type-check, resolve packages or aliases, infer runtime behavior, or explain why code changed. Line-level historical diffing remains future work.

### Historical graph analysis

`POST /api/repositories/analyze-history` preserves its existing `repository`, `sha`, `parentSha`, and `files` fields and additionally returns `graph`. The graph includes `symbol-change` nodes for applicable added, removed, and modified classes, functions, and methods. Each change node has a deterministic ID containing the commit SHA, file path, symbol type, symbol name, and change type. It has a `changed` edge from the commit and an `in-file` edge to the file. Added and modified changes also have an `affects` edge to an existing structural symbol node; removed symbols do not create phantom structural nodes. Inapplicable non-TypeScript files produce no symbol-change nodes.

## Documentation

- [Roadmap](docs/roadmap.md)
- [Architecture](docs/architecture.md)
- [Technical decisions](docs/decisions.md)
