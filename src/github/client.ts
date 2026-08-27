export function getGitHubRequestOptions(): RequestInit {
    const token = process.env.GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json"
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return { headers };
}

export function isGitHubRateLimitResponse(response: Response): boolean {
    return response.status === 429 ||
        (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
}

export function getGitHubRateLimitError(response: Response): string | null {
    if (!isGitHubRateLimitResponse(response)) return null;

    const reset = response.headers.get("x-ratelimit-reset");
    if (!reset) return "GitHub API rate limit exceeded.";

    const resetTime = Number.parseInt(reset, 10);
    if (!Number.isFinite(resetTime)) return "GitHub API rate limit exceeded.";

    return `GitHub API rate limit exceeded. Try again after ${new Date(resetTime * 1000).toISOString()}.`;
}
