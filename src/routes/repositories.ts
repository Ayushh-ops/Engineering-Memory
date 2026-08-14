import { Request, Response, Router } from "express";

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
}

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

export default router;
