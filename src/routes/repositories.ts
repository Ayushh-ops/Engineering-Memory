import { Request, Response, Router } from "express";
import { analyzeTypeScript } from "../analyzers/typescript";
import {
    analyzeHistoricalTypeScriptChange,
    isTypeScriptPath
} from "../analyzers/typescript-history";
import {
    isRepositoryGraph,
    isRepositoryGraphQuery,
    queryRepositoryGraph
} from "../graph/repository-query";
import {
    assembleRepositoryContext,
    isRepositoryContextRequest
} from "../graph/repository-context";
import {
    getGitHubRateLimitError,
    getGitHubRequestOptions
} from "../github/client";
import { RepositoryAnalysisService } from "../services/repository-analysis-service";

interface GitHubRepository {
    name: string;
    full_name: string;
    owner: {
        login: string;
    };
    description: string | null;
    language: string | null;
    stargazers_count: number;
    forks_count: number;
    html_url: string;
}

interface GitHubCommit {
    sha: string;
    commit: {
        message: string;
        author: {
            name: string;
            date: string;
        };
    };
}

interface GitHubCommitFile {
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
}

interface GitHubCommitDetails {
    commit: {
        message: string;
        author: {
            name: string;
            date: string;
        };
    };
    files?: GitHubCommitFile[];
    parents?: Array<{ sha: string }>;
}

interface GitHubFileContent {
    type: string;
    content: string;
    encoding: string;
}

type HistoricalFileResult =
    | { status: "success"; content: string }
    | { status: "not-found" }
    | { status: "not-file" }
    | { status: "rate-limit" }
    | { status: "api-failure" };

const router = Router();
const repositoryAnalysisService = new RepositoryAnalysisService();

function parseGitHubRepositoryUrl(value: unknown): { owner: string; repository: string } | null {
    if (typeof value !== "string") {
        return null;
    }

    try {
        const url = new URL(value);
        const pathParts = url.pathname.split("/").filter(Boolean);

        if (
            url.protocol !== "https:" ||
            url.hostname.toLowerCase() !== "github.com" ||
            pathParts.length !== 2
        ) {
            return null;
        }

        const [owner, repository] = pathParts;
        if (!owner || !repository) {
            return null;
        }

        return { owner, repository: repository.replace(/\.git$/, "") };
    } catch {
        return null;
    }
}

async function retrieveHistoricalFileContent(
    owner: string,
    repository: string,
    path: string,
    sha: string
): Promise<HistoricalFileResult> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const githubResponse = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`,
        getGitHubRequestOptions()
    );

    if (githubResponse.status === 404) {
        return { status: "not-found" };
    }

    if (getGitHubRateLimitError(githubResponse)) {
        return { status: "rate-limit" };
    }

    if (!githubResponse.ok) {
        return { status: "api-failure" };
    }

    const githubFile = (await githubResponse.json()) as GitHubFileContent | GitHubFileContent[];

    if (Array.isArray(githubFile) || githubFile.type !== "file") {
        return { status: "not-file" };
    }

    return {
        status: "success",
        content: Buffer.from(githubFile.content, "base64").toString("utf8")
    };
}

router.post("/repositories", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
            getGitHubRequestOptions()
        );

        if (githubResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository not found." });
        }

        const rateLimitError = getGitHubRateLimitError(githubResponse);
        if (rateLimitError) {
            return res.status(429).json({ error: rateLimitError });
        }

        if (!githubResponse.ok) {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        const githubRepository = (await githubResponse.json()) as GitHubRepository;

        return res.status(200).json({
            name: githubRepository.name,
            fullName: githubRepository.full_name,
            owner: githubRepository.owner.login,
            description: githubRepository.description,
            language: githubRepository.language,
            stars: githubRepository.stargazers_count,
            forks: githubRepository.forks_count,
            htmlUrl: githubRepository.html_url
        });
    } catch {
        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/commits", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?per_page=10`,
            getGitHubRequestOptions()
        );

        if (githubResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository not found." });
        }

        const rateLimitError = getGitHubRateLimitError(githubResponse);
        if (rateLimitError) {
            return res.status(429).json({ error: rateLimitError });
        }

        if (!githubResponse.ok) {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        const githubCommits = (await githubResponse.json()) as GitHubCommit[];

        const commits = await Promise.all(
            githubCommits.map(async (commit) => {
                const commitDetailsResponse = await fetch(
                    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(commit.sha)}`,
                    getGitHubRequestOptions()
                );

                const rateLimitError = getGitHubRateLimitError(commitDetailsResponse);
                if (rateLimitError) {
                    throw new Error(rateLimitError);
                }

                if (!commitDetailsResponse.ok) {
                    throw new Error("GitHub commit details request failed.");
                }

                const commitDetails = (await commitDetailsResponse.json()) as GitHubCommitDetails;

                return {
                    sha: commit.sha,
                    message: commit.commit.message,
                    authorName: commit.commit.author.name,
                    authorDate: commit.commit.author.date,
                    files: (commitDetails.files ?? []).map((file) => ({
                        filename: file.filename,
                        status: file.status,
                        additions: file.additions,
                        deletions: file.deletions,
                        changes: file.changes
                    }))
                };
            })
        );

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            commits
        });
    } catch (error) {
        if (error instanceof Error && error.message === "GitHub commit details request failed.") {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        if (error instanceof Error && error.message.startsWith("GitHub API rate limit exceeded.")) {
            return res.status(429).json({ error: error.message });
        }

        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/file", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const path = req.body?.path;
    const sha = req.body?.sha;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    if (typeof path !== "string" || path.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty file path is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const result = await retrieveHistoricalFileContent(owner, repository, path, sha);

        if (result.status === "not-found") {
            return res.status(404).json({ error: "GitHub repository or file not found." });
        }

        if (result.status === "rate-limit") {
            return res.status(429).json({ error: "GitHub API rate limit exceeded." });
        }

        if (result.status === "api-failure") {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        if (result.status === "not-file") {
            return res.status(400).json({ error: "The requested path must refer to a file." });
        }

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            path,
            sha,
            content: result.content
        });
    } catch {
        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/analyze-file", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const path = req.body?.path;
    const sha = req.body?.sha;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    if (typeof path !== "string" || path.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty file path is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const result = await retrieveHistoricalFileContent(owner, repository, path, sha);

        if (result.status === "not-found") {
            return res.status(404).json({ error: "GitHub repository or file not found." });
        }

        if (result.status === "rate-limit") {
            return res.status(429).json({ error: "GitHub API rate limit exceeded." });
        }

        if (result.status === "api-failure") {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        if (result.status === "not-file") {
            return res.status(400).json({ error: "The requested path must refer to a file." });
        }

        return res.status(200).json(
            repositoryAnalysisService.analyzeFile(
                { owner, repository },
                sha,
                path,
                result.content
            )
        );
    } catch {
        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/analyze", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const sha = req.body?.sha;
    const paths = req.body?.paths;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty commit SHA is required." });
    }

    if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ error: "A non-empty paths array is required." });
    }

    if (paths.length > 20) {
        return res.status(400).json({ error: "A maximum of 20 file paths is allowed." });
    }

    if (paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
        return res.status(400).json({ error: "Every path must be a non-empty string." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const results = await Promise.all(
            paths.map((path) => retrieveHistoricalFileContent(owner, repository, path, sha))
        );

        for (const result of results) {
            if (result.status === "not-found") {
                return res.status(404).json({ error: "GitHub repository or file not found." });
            }

            if (result.status === "rate-limit") {
                return res.status(429).json({ error: "GitHub API rate limit exceeded." });
            }

            if (result.status === "api-failure") {
                return res.status(502).json({ error: "GitHub API request failed." });
            }

            if (result.status === "not-file") {
                return res.status(400).json({ error: "The requested path must refer to a file." });
            }
        }

        const repositoryFiles = results.map((result, index) => {
            if (result.status !== "success") {
                throw new Error("Unexpected historical file result.");
            }

            return {
                path: paths[index],
                content: result.content
            };
        });

        return res.status(200).json(
            repositoryAnalysisService.analyzeFiles(
                { owner, repository },
                sha,
                repositoryFiles
            )
        );
    } catch {
        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/analyze-history", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const sha = req.body?.sha;
    const paths = req.body?.paths;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ error: "A valid GitHub repository URL is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ error: "A non-empty commit SHA is required." });
    }

    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20) {
        return res.status(400).json({ error: "Between 1 and 20 file paths are required." });
    }

    if (paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
        return res.status(400).json({ error: "Every path must be a non-empty string." });
    }

    if (new Set(paths).size !== paths.length) {
        return res.status(400).json({ error: "Every path must be unique." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const commitResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(sha)}`,
            getGitHubRequestOptions()
        );

        if (commitResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository or commit not found." });
        }

        const rateLimitError = getGitHubRateLimitError(commitResponse);
        if (rateLimitError) {
            return res.status(429).json({ error: rateLimitError });
        }

        if (!commitResponse.ok) {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        const commit = (await commitResponse.json()) as GitHubCommitDetails;
        const parentSha = commit.parents?.[0]?.sha ?? null;
        const historicalResults = await Promise.all(paths.map(async (path) => {
            if (!isTypeScriptPath(path)) {
                return {
                    change: analyzeHistoricalTypeScriptChange(path, null, null),
                    currentFile: {
                        path,
                        analysis: analyzeTypeScript("")
                    },
                    parentContent: null,
                    currentContent: null
                };
            }

            const [parentResult, currentResult] = await Promise.all([
                parentSha
                    ? retrieveHistoricalFileContent(owner, repository, path, parentSha)
                    : Promise.resolve<HistoricalFileResult>({ status: "not-found" }),
                retrieveHistoricalFileContent(owner, repository, path, sha)
            ]);

            for (const result of [parentResult, currentResult]) {
                if (result.status === "api-failure") {
                    throw new Error("GitHub file request failed.");
                }

                if (result.status === "rate-limit") {
                    throw new Error("GitHub API rate limit exceeded.");
                }

                if (result.status === "not-file") {
                    throw new Error("GitHub path is not a file.");
                }
            }

            const parentContent = parentResult.status === "success" ? parentResult.content : null;
            const currentContent = currentResult.status === "success" ? currentResult.content : null;

            return {
                change: analyzeHistoricalTypeScriptChange(path, parentContent, currentContent),
                currentFile: {
                    path,
                    analysis: currentContent !== null
                        ? analyzeTypeScript(currentContent)
                        : analyzeTypeScript("")
                },
                parentContent,
                currentContent
            };
        }));

        const files = historicalResults.map((result) => result.change);
        const historyCommit = {
            sha,
            message: commit.commit.message,
            authorName: commit.commit.author.name,
            authorDate: commit.commit.author.date,
            files: (commit.files ?? []).map((file) => ({ filename: file.filename }))
        };
        const historicalChanges = {
            sha,
            files
        };

        return res.status(200).json(
            repositoryAnalysisService.analyzeHistoricalFiles(
                { owner, repository },
                sha,
                parentSha,
                historicalResults.map((result) => ({
                    path: result.currentFile.path,
                    parentContent: result.parentContent,
                    currentContent: result.currentContent
                })),
                [historyCommit],
                historicalChanges
            )
        );
    } catch (error) {
        if (error instanceof Error && error.message === "GitHub path is not a file.") {
            return res.status(400).json({ error: "The requested path must refer to a file." });
        }

        if (error instanceof Error && error.message === "GitHub file request failed.") {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        if (error instanceof Error && error.message.startsWith("GitHub API rate limit exceeded.")) {
            return res.status(429).json({ error: error.message });
        }

        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

router.post("/repositories/graph/query", (req: Request, res: Response) => {
    const graph = req.body?.graph;
    const query = req.body?.query;

    if (!isRepositoryGraph(graph) || !isRepositoryGraphQuery(query)) {
        return res.status(400).json({ error: "A valid graph and query are required." });
    }

    return res.status(200).json({ query, results: queryRepositoryGraph(graph, query) });
});

router.post("/repositories/graph/context", (req: Request, res: Response) => {
    const graph = req.body?.graph;
    const request = req.body?.request;

    if (!isRepositoryGraph(graph) || !isRepositoryContextRequest(request)) {
        return res.status(400).json({ error: "A valid graph and context request are required." });
    }

    const result = assembleRepositoryContext(graph, request);
    if (result.status === "missing") {
        return res.status(400).json({ error: "The requested context target was not found." });
    }
    if (result.status === "ambiguous") {
        return res.status(400).json({ error: "The requested context target is ambiguous." });
    }
    return res.status(200).json(result.context);
});

export default router;
