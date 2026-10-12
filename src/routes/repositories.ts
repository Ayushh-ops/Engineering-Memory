import { Request, Response, Router } from "express";
import {
    registry,
    analyzeSource,
    getAnalyzerForPath,
    extractDeclarationsForPath
} from "../analyzers/registry";
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
    getGitHubRequestOptions,
    mapGitHubResponseToError,
    mapGitHubFetchError,
    type GitHubErrorMapping
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
            email?: string;
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

interface GitHubTreeItem {
    path: string;
    mode: string;
    type: string;
    size?: number;
    sha: string;
    url: string;
}

interface GitHubTreeResponse {
    sha: string;
    url: string;
    tree: GitHubTreeItem[];
    truncated: boolean;
}

type HistoricalFileResult =
    | { status: "success"; content: string }
    | { status: "not-found"; error: GitHubErrorMapping }
    | { status: "rate-limit"; error: GitHubErrorMapping }
    | { status: "auth-failed"; error: GitHubErrorMapping }
    | { status: "unreachable"; error: GitHubErrorMapping }
    | { status: "not-file" }
    | { status: "api-failure"; error: GitHubErrorMapping };

const router = Router();
const repositoryAnalysisService = new RepositoryAnalysisService();

export function sendGitHubError(res: Response, mapped: GitHubErrorMapping) {
    if (mapped.retryAfterSeconds) {
        res.setHeader("Retry-After", String(mapped.retryAfterSeconds));
    }
    return res.status(mapped.status).json({
        code: mapped.code,
        error: mapped.message,
        message: mapped.message,
        ...(mapped.retryAfterSeconds ? { retryAfterSeconds: mapped.retryAfterSeconds } : {})
    });
}

export function parseGitHubRepositoryUrl(value: unknown): { owner: string; repository: string } | null {
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
    let githubResponse: globalThis.Response;
    try {
        githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodedPath}?ref=${encodeURIComponent(sha)}`,
            getGitHubRequestOptions()
        );
    } catch (error) {
        return { status: "unreachable", error: mapGitHubFetchError(error) };
    }

    const mapped = mapGitHubResponseToError(githubResponse);
    if (mapped) {
        if (mapped.code === "repo_not_found") {
            return { status: "not-found", error: mapped };
        }
        if (mapped.code === "github_rate_limited") {
            return { status: "rate-limit", error: mapped };
        }
        if (mapped.code === "github_auth_failed") {
            return { status: "auth-failed", error: mapped };
        }
        return { status: "api-failure", error: mapped };
    }

    let githubFile: GitHubFileContent | GitHubFileContent[];
    try {
        githubFile = (await githubResponse.json()) as GitHubFileContent | GitHubFileContent[];
    } catch {
        return {
            status: "api-failure",
            error: {
                status: 502,
                code: "api_failure",
                message: "GitHub API request failed."
            }
        };
    }

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
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
            getGitHubRequestOptions()
        );

        const mapped = mapGitHubResponseToError(githubResponse);
        if (mapped) {
            return sendGitHubError(res, mapped);
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
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.post("/repositories/commits", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    const { owner, repository } = parsedRepository;
    const path = typeof req.body?.path === "string" && req.body.path.trim().length > 0 ? req.body.path.trim() : undefined;
    const sha = typeof req.body?.sha === "string" && req.body.sha.trim().length > 0 ? req.body.sha.trim() : undefined;

    try {
        if (path) {
            let commitsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?per_page=30&path=${encodeURIComponent(path)}`;
            if (sha) {
                commitsUrl += `&sha=${encodeURIComponent(sha)}`;
            }

            const githubResponse = await fetch(commitsUrl, getGitHubRequestOptions());

            const mapped = mapGitHubResponseToError(githubResponse);
            if (mapped) {
                return sendGitHubError(res, mapped);
            }

            const githubCommits = (await githubResponse.json()) as GitHubCommit[];

            const commits = githubCommits.map((commit) => ({
                sha: commit.sha,
                message: commit.commit.message?.split("\n")[0] || commit.commit.message || "",
                authorName: commit.commit.author?.name || "Unknown",
                authorDate: commit.commit.author?.date || "",
                files: []
            }));

            return res.status(200).json({
                repository: `${owner}/${repository}`,
                commits
            });
        }

        const githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?per_page=10`,
            getGitHubRequestOptions()
        );

        const mapped = mapGitHubResponseToError(githubResponse);
        if (mapped) {
            return sendGitHubError(res, mapped);
        }

        const githubCommits = (await githubResponse.json()) as GitHubCommit[];

        const commits = await Promise.all(
            githubCommits.map(async (commit) => {
                const commitDetailsResponse = await fetch(
                    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(commit.sha)}`,
                    getGitHubRequestOptions()
                );

                const detailMapped = mapGitHubResponseToError(commitDetailsResponse);
                if (detailMapped) {
                    const err = new Error(detailMapped.message);
                    (err as any).mapped = detailMapped;
                    throw err;
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
    } catch (error: any) {
        if (error?.mapped) {
            return sendGitHubError(res, error.mapped);
        }
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

interface FileOwner {
    name: string;
    count: number;
    share: number;
}

interface FileOwnersResponse {
    repository: string;
    path: string;
    totalCommits: number;
    owners: FileOwner[];
    busFactorRisk: boolean;
}

const fileOwnersCache = new Map<string, { timestamp: number; data: FileOwnersResponse }>();
const FILE_OWNERS_CACHE_TTL_MS = 5 * 60 * 1000;

router.post("/repositories/owners", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    const { owner, repository } = parsedRepository;
    const path = typeof req.body?.path === "string" && req.body.path.trim().length > 0 ? req.body.path.trim() : undefined;
    const sha = typeof req.body?.sha === "string" && req.body.sha.trim().length > 0 ? req.body.sha.trim() : undefined;

    if (!path) {
        return res.status(400).json({ code: "bad_request", error: "A file path is required.", message: "A file path is required." });
    }

    const cacheKey = `${owner}/${repository}:${path}:${sha || "default"}`;
    const cached = fileOwnersCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < FILE_OWNERS_CACHE_TTL_MS) {
        return res.status(200).json(cached.data);
    }

    try {
        let commitsUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?per_page=50&path=${encodeURIComponent(path)}`;
        if (sha) {
            commitsUrl += `&sha=${encodeURIComponent(sha)}`;
        }

        const githubResponse = await fetch(commitsUrl, getGitHubRequestOptions());

        const mapped = mapGitHubResponseToError(githubResponse);
        if (mapped) {
            return sendGitHubError(res, mapped);
        }

        const githubCommits = (await githubResponse.json()) as GitHubCommit[];

        const authorMap = new Map<string, { name: string; count: number }>();
        let totalCommits = 0;

        for (const commit of githubCommits) {
            const rawEmail = commit.commit?.author?.email?.trim().toLowerCase();
            const rawName = commit.commit?.author?.name?.trim();
            const key = rawEmail || (rawName ? rawName.toLowerCase() : "unknown");
            const existing = authorMap.get(key);
            if (existing) {
                existing.count++;
                if ((!existing.name || existing.name === "Unknown") && rawName) {
                    existing.name = rawName;
                }
            } else {
                authorMap.set(key, {
                    name: rawName || rawEmail || "Unknown",
                    count: 1
                });
            }
            totalCommits++;
        }

        const sortedAuthors = Array.from(authorMap.values())
            .map(({ name, count }) => ({
                name,
                count,
                share: totalCommits > 0 ? Math.round((count / totalCommits) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

        const owners = sortedAuthors.slice(0, 3);
        const busFactorRisk = totalCommits >= 5 && owners.length > 0 && owners[0].share >= 70;

        const result: FileOwnersResponse = {
            repository: `${owner}/${repository}`,
            path,
            totalCommits,
            owners,
            busFactorRisk
        };

        fileOwnersCache.set(cacheKey, { timestamp: Date.now(), data: result });

        return res.status(200).json(result);
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.post("/repositories/tree", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const sha = req.body?.sha;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty commit SHA is required.", message: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const githubResponse = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
            getGitHubRequestOptions()
        );

        const mapped = mapGitHubResponseToError(githubResponse);
        if (mapped) {
            return sendGitHubError(res, mapped);
        }

        const treeResponse = (await githubResponse.json()) as GitHubTreeResponse;

        // Filter to only blobs (files) and supported typescript source files mapping deterministic results
        const files = (treeResponse.tree ?? [])
            .filter(item => item.type === "blob" && typeof item.path === "string")
            .map(item => item.path)
            .sort();

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            sha,
            files,
            truncated: !!treeResponse.truncated
        });
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.post("/repositories/file", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const path = req.body?.path;
    const sha = req.body?.sha;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    if (typeof path !== "string" || path.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty file path is required.", message: "A non-empty file path is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty commit SHA is required.", message: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const result = await retrieveHistoricalFileContent(owner, repository, path, sha);

        if (result.status !== "success") {
            if (result.status === "not-file") {
                return res.status(400).json({ code: "not_file", error: "The requested path must refer to a file.", message: "The requested path must refer to a file." });
            }
            return sendGitHubError(res, result.error);
        }

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            path,
            sha,
            content: result.content
        });
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.get("/file", async (req: Request, res: Response) => {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    const rawPath = typeof req.query.path === "string" ? req.query.path : "";
    const rawSha = typeof req.query.sha === "string" ? req.query.sha : "";

    const parsedRepository = parseGitHubRepositoryUrl(rawUrl);
    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    if (!rawPath.trim()) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty file path is required.", message: "A non-empty file path is required." });
    }

    // Path traversal check
    const normalized = rawPath.replace(/\\/g, "/");
    if (normalized.startsWith("/") || normalized.includes("..") || normalized.split("/").includes("..")) {
        return res.status(400).json({ code: "bad_request", error: "Invalid file path (path traversal detected).", message: "Invalid file path (path traversal detected)." });
    }

    if (!rawSha.trim()) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty commit SHA is required.", message: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;
    try {
        const result = await retrieveHistoricalFileContent(owner, repository, normalized, rawSha.trim());
        if (result.status !== "success") {
            if (result.status === "not-file") {
                return res.status(400).json({ code: "not_file", error: "The requested path must refer to a file.", message: "The requested path must refer to a file." });
            }
            return sendGitHubError(res, result.error);
        }

        // Cap content at 200 KB (200 * 1024 bytes)
        const MAX_BYTES = 200 * 1024;
        let content = result.content;
        let truncated = false;
        if (Buffer.byteLength(content, "utf8") > MAX_BYTES) {
            content = Buffer.from(content, "utf8").subarray(0, MAX_BYTES).toString("utf8");
            truncated = true;
        }

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            path: normalized,
            sha: rawSha.trim(),
            content,
            truncated
        });
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.post("/repositories/analyze-file", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const path = req.body?.path;
    const sha = req.body?.sha;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    if (typeof path !== "string" || path.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty file path is required.", message: "A non-empty file path is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty commit SHA is required.", message: "A non-empty commit SHA is required." });
    }

    const { owner, repository } = parsedRepository;

    try {
        const result = await retrieveHistoricalFileContent(owner, repository, path, sha);

        if (result.status !== "success") {
            if (result.status === "not-file") {
                return res.status(400).json({ code: "not_file", error: "The requested path must refer to a file.", message: "The requested path must refer to a file." });
            }
            return sendGitHubError(res, result.error);
        }

        return res.status(200).json(
            repositoryAnalysisService.analyzeFile(
                { owner, repository },
                sha,
                path,
                result.content
            )
        );
    } catch (error) {
        return sendGitHubError(res, mapGitHubFetchError(error));
    }
});

router.post("/repositories/analyze", async (req: Request, res: Response) => {
    const parsedRepository = parseGitHubRepositoryUrl(req.body?.url);
    const sha = req.body?.sha;
    const paths = req.body?.paths;

    if (!parsedRepository || !parsedRepository.repository) {
        return res.status(400).json({ code: "bad_request", error: "A valid GitHub repository URL is required.", message: "A valid GitHub repository URL is required." });
    }

    if (typeof sha !== "string" || sha.trim().length === 0) {
        return res.status(400).json({ code: "bad_request", error: "A non-empty commit SHA is required.", message: "A non-empty commit SHA is required." });
    }

    if (!Array.isArray(paths) || paths.length === 0) {
        return res.status(400).json({ code: "repo_empty", error: "No supported source files found in this repository.", message: "No supported source files found in this repository." });
    }

    const maxAnalysisFiles = parseInt(process.env.ANALYSIS_MAX_FILES || "500", 10);
    if (paths.length > maxAnalysisFiles) {
        return res.status(400).json({ code: "bad_request", error: `A maximum of ${maxAnalysisFiles} file paths is allowed.`, message: `A maximum of ${maxAnalysisFiles} file paths is allowed.` });
    }

    if (paths.some((path) => typeof path !== "string" || path.trim().length === 0)) {
        return res.status(400).json({ code: "bad_request", error: "Every path must be a non-empty string.", message: "Every path must be a non-empty string." });
    }

    const { owner, repository } = parsedRepository;
    const isSse = req.headers.accept?.includes("text/event-stream") || req.query.stream === "true";

    if (isSse) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        if (typeof res.flushHeaders === "function") {
            res.flushHeaders();
        }
    }

    const sendProgress = (stage: string, percent: number) => {
        if (isSse) {
            res.write(`data: ${JSON.stringify({ stage, percent })}\n\n`);
        }
    };

    try {
        sendProgress("Cloning repository", 25);
        const results = await Promise.all(
            paths.map((path) => retrieveHistoricalFileContent(owner, repository, path, sha))
        );

        for (const result of results) {
            if (result.status !== "success") {
                if (result.status === "not-file") {
                    if (isSse) {
                        res.write(`data: ${JSON.stringify({ error: "The requested path must refer to a file.", code: "not_file", message: "The requested path must refer to a file." })}\n\n`);
                        return res.end();
                    }
                    return res.status(400).json({ code: "not_file", error: "The requested path must refer to a file.", message: "The requested path must refer to a file." });
                }

                if (isSse) {
                    res.write(`data: ${JSON.stringify({
                        error: result.error.message,
                        code: result.error.code,
                        message: result.error.message,
                        ...(result.error.retryAfterSeconds ? { retryAfterSeconds: result.error.retryAfterSeconds } : {})
                    })}\n\n`);
                    return res.end();
                }
                return sendGitHubError(res, result.error);
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

        sendProgress("Parsing symbols", 50);
        sendProgress("Linking calls and imports", 75);
        const analyzeResult = repositoryAnalysisService.analyzeFiles(
            { owner, repository },
            sha,
            repositoryFiles
        );

        sendProgress("Building the graph", 100);

        if (isSse) {
            res.write(`data: ${JSON.stringify({ stage: "Building the graph", percent: 100, result: analyzeResult })}\n\n`);
            return res.end();
        }

        return res.status(200).json(analyzeResult);
    } catch (error) {
        const mapped = mapGitHubFetchError(error);
        if (isSse) {
            res.write(`data: ${JSON.stringify({ error: mapped.message, code: mapped.code, message: mapped.message })}\n\n`);
            return res.end();
        }
        return sendGitHubError(res, mapped);
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
                        analysis: registry.analyzeSource("", path)
                    },
                    parentContent: null,
                    currentContent: null
                };
            }

            const [parentResult, currentResult] = await Promise.all([
                parentSha
                    ? retrieveHistoricalFileContent(owner, repository, path, parentSha)
                    : Promise.resolve<HistoricalFileResult>({
                        status: "not-found",
                        error: {
                            status: 404,
                            code: "repo_not_found",
                            message: "Repository not found. Check the URL, or it may be private."
                        }
                    }),
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
                        ? registry.analyzeSource(currentContent, path)
                        : registry.analyzeSource("", path)
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
