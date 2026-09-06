import { getGitHubRateLimitError, getGitHubRequestOptions } from "./client";

export interface GitHubRepositoryFile {
    path: string;
    content: string;
}

export type GitHubRepositoryFileErrorCode =
    | "not_found"
    | "not_file"
    | "rate_limit"
    | "api_failure"
    | "network_failure";

export class GitHubRepositoryFileError extends Error {
    constructor(
        public readonly code: GitHubRepositoryFileErrorCode,
        message: string
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

export class GitHubRepositoryFileClient {
    async loadFile(
        owner: string,
        repository: string,
        path: string,
        sha: string
    ): Promise<GitHubRepositoryFile> {
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`;

        let response: Response;
        try {
            response = await fetch(url, getGitHubRequestOptions());
        } catch {
            throw new GitHubRepositoryFileError(
                "network_failure",
                "Unable to reach the GitHub API."
            );
        }

        if (response.status === 404) {
            throw new GitHubRepositoryFileError(
                "not_found",
                "GitHub repository or file not found."
            );
        }

        const rateLimitError = getGitHubRateLimitError(response);
        if (rateLimitError) {
            throw new GitHubRepositoryFileError("rate_limit", rateLimitError);
        }

        if (!response.ok) {
            throw new GitHubRepositoryFileError(
                "api_failure",
                "GitHub API request failed."
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

        return {
            path,
            content: Buffer.from(file.content, "base64").toString("utf8")
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
