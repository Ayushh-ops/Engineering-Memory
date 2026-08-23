import { Request, Response, Router } from "express";
import { analyzeTypeScript } from "../analyzers/typescript";
import {
    analyzeHistoricalTypeScriptChange,
    isTypeScriptPath
} from "../analyzers/typescript-history";
import {
    RepositoryFileAnalysis,
    resolveRelativeImportRelationships
} from "../resolvers/relative-imports";
import { buildRepositoryGraph } from "../graph/repository-graph";

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
    | { status: "api-failure" };

const router = Router();

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
        { headers: { Accept: "application/vnd.github+json" } }
    );

    if (githubResponse.status === 404) {
        return { status: "not-found" };
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
            { headers: { Accept: "application/vnd.github+json" } }
        );

        if (githubResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository not found." });
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
            { headers: { Accept: "application/vnd.github+json" } }
        );

        if (githubResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository not found." });
        }

        if (!githubResponse.ok) {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        const githubCommits = (await githubResponse.json()) as GitHubCommit[];

        const commits = await Promise.all(
            githubCommits.map(async (commit) => {
                const commitDetailsResponse = await fetch(
                    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits/${encodeURIComponent(commit.sha)}`,
                    { headers: { Accept: "application/vnd.github+json" } }
                );

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
            analysis: analyzeTypeScript(result.content)
        });
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

            if (result.status === "api-failure") {
                return res.status(502).json({ error: "GitHub API request failed." });
            }

            if (result.status === "not-file") {
                return res.status(400).json({ error: "The requested path must refer to a file." });
            }
        }

        const files: RepositoryFileAnalysis[] = results.map((result, index) => {
            if (result.status !== "success") {
                throw new Error("Unexpected historical file result.");
            }

            return {
                path: paths[index],
                analysis: analyzeTypeScript(result.content)
            };
        });

        const repositoryName = `${owner}/${repository}`;
        const resolvedRelationships = resolveRelativeImportRelationships(files);

        return res.status(200).json({
            repository: repositoryName,
            sha,
            files,
            resolvedRelationships,
            graph: buildRepositoryGraph(repositoryName, files, resolvedRelationships)
        });
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
            { headers: { Accept: "application/vnd.github+json" } }
        );

        if (commitResponse.status === 404) {
            return res.status(404).json({ error: "GitHub repository or commit not found." });
        }

        if (!commitResponse.ok) {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        const commit = (await commitResponse.json()) as GitHubCommitDetails;
        const parentSha = commit.parents?.[0]?.sha ?? null;
        const files = await Promise.all(paths.map(async (path) => {
            if (!isTypeScriptPath(path)) {
                return analyzeHistoricalTypeScriptChange(path, null, null);
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

                if (result.status === "not-file") {
                    throw new Error("GitHub path is not a file.");
                }
            }

            return analyzeHistoricalTypeScriptChange(
                path,
                parentResult.status === "success" ? parentResult.content : null,
                currentResult.status === "success" ? currentResult.content : null
            );
        }));

        return res.status(200).json({
            repository: `${owner}/${repository}`,
            sha,
            parentSha,
            files
        });
    } catch (error) {
        if (error instanceof Error && error.message === "GitHub path is not a file.") {
            return res.status(400).json({ error: "The requested path must refer to a file." });
        }

        if (error instanceof Error && error.message === "GitHub file request failed.") {
            return res.status(502).json({ error: "GitHub API request failed." });
        }

        return res.status(502).json({ error: "Unable to reach the GitHub API." });
    }
});

export default router;
