import {
    getGitHubRateLimitError,
    getGitHubRequestOptions,
    mapGitHubFetchError,
    mapGitHubResponseToError
} from "./client";

export interface GitHubRepositoryFile {
    path: string;
    content: string;
}

export type GitHubRepositoryFileErrorCode =
    | "not_found"
    | "not_file"
    | "rate_limit"
    | "auth_failed"
    | "api_failure"
    | "network_failure";

export class GitHubRepositoryFileError extends Error {
    constructor(
        public readonly code: GitHubRepositoryFileErrorCode,
        message: string,
        public readonly retryAfterSeconds?: number
    ) {
        super(message);
        this.name = "GitHubRepositoryFileError";
    }
}

interface GitHubFileContent {
    type: string;
    content: string;
    encoding: string;
}

export class FileContentCache {
    private cache = new Map<string, { content: string; expiresAt: number }>();
    private readonly maxSize: number;
    private readonly ttlMs: number;

    constructor(maxSize = 300, ttlMs = 30 * 60 * 1000) {
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    public get(key: string): string | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        this.cache.delete(key);
        this.cache.set(key, entry);
        return entry.content;
    }

    public set(key: string, content: string): void {
        if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }
        this.cache.set(key, {
            content,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    public clear(): void {
        this.cache.clear();
    }

    public size(): number {
        return this.cache.size;
    }
}

export const fileContentCache = new FileContentCache(300, 30 * 60 * 1000);

export class GitHubRepositoryFileClient {
    constructor(private readonly cache: FileContentCache = fileContentCache) {}

    public getCache(): FileContentCache {
        return this.cache;
    }

    cacheDependent(owner: string, repository: string, path: string, sha: string, content: string): void {
        const cacheKey = `${owner}/${repository}:${sha}:${path}`;
        const first40 = content.split("\n").slice(0, 40).join("\n");
        this.cache.set(cacheKey, first40);
    }

    async loadFile(
        owner: string,
        repository: string,
        path: string,
        sha: string
    ): Promise<GitHubRepositoryFile> {
        const cacheKey = `${owner}/${repository}:${sha}:${path}`;
        const cached = this.cache.get(cacheKey);
        if (cached !== null) {
            return { path, content: cached };
        }

        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`;

        let response: Response;
        try {
            response = await fetch(url, getGitHubRequestOptions());
        } catch {
            throw new GitHubRepositoryFileError(
                "network_failure",
                "Cannot reach GitHub. Check your internet connection."
            );
        }

        const mappedError = mapGitHubResponseToError(response);
        if (mappedError) {
            if (mappedError.code === "repo_not_found") {
                throw new GitHubRepositoryFileError(
                    "not_found",
                    "Repository not found. Check the URL, or it may be private."
                );
            }
            if (mappedError.code === "github_rate_limited") {
                throw new GitHubRepositoryFileError(
                    "rate_limit",
                    mappedError.message,
                    mappedError.retryAfterSeconds
                );
            }
            if (mappedError.code === "github_auth_failed") {
                throw new GitHubRepositoryFileError(
                    "auth_failed",
                    mappedError.message
                );
            }
            throw new GitHubRepositoryFileError(
                "api_failure",
                mappedError.message
            );
        }

        let file: GitHubFileContent | GitHubFileContent[];
        try {
            file = await response.json() as GitHubFileContent | GitHubFileContent[];
        } catch {
            throw new GitHubRepositoryFileError(
                "api_failure",
                "GitHub API request failed."
            );
        }

        if (Array.isArray(file) || file.type !== "file") {
            throw new GitHubRepositoryFileError(
                "not_file",
                "The requested path must refer to a file."
            );
        }

        const content = Buffer.from(file.content, "base64").toString("utf8");
        this.cache.set(cacheKey, content);
        return {
            path,
            content
        };
    }

    async loadFiles(
        owner: string,
        repository: string,
        paths: string[],
        sha: string
    ): Promise<GitHubRepositoryFile[]> {
        return Promise.all(paths.map((path) => this.loadFile(owner, repository, path, sha)));
    }
}
