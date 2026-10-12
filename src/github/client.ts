export interface GitHubErrorMapping {
    status: number;
    code: "repo_not_found" | "github_rate_limited" | "github_auth_failed" | "github_unreachable" | "repo_empty" | "api_failure";
    message: string;
    retryAfterSeconds?: number;
}

export function getGitHubRequestOptions(signal?: AbortSignal, timeoutMs = 15000): RequestInit {
    const token = process.env.GITHUB_TOKEN?.trim();
    const headers: Record<string, string> = {
        Accept: "application/vnd.github+json"
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    let timeoutSignal: AbortSignal | undefined;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
        try {
            timeoutSignal = AbortSignal.timeout(timeoutMs);
        } catch {
            // fallback
        }
    }

    let combinedSignal: AbortSignal | undefined = timeoutSignal;
    if (signal && timeoutSignal && typeof AbortSignal.any === "function") {
        combinedSignal = AbortSignal.any([signal, timeoutSignal]);
    } else if (signal) {
        combinedSignal = signal;
    }

    return {
        headers,
        ...(combinedSignal ? { signal: combinedSignal } : {})
    };
}

export function isGitHubRateLimitResponse(response: Response): boolean {
    return response.status === 429 ||
        (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0");
}

export function getGitHubRateLimitResetSeconds(response: Response): number {
    const reset = response.headers.get("x-ratelimit-reset");
    if (!reset) return 60;
    const resetTime = Number.parseInt(reset, 10);
    if (!Number.isFinite(resetTime)) return 60;
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.max(1, resetTime - nowSec);
}

export function getGitHubRateLimitMinutes(response: Response): number {
    const sec = getGitHubRateLimitResetSeconds(response);
    return Math.max(1, Math.ceil(sec / 60));
}

export function getGitHubRateLimitError(response: Response): string | null {
    if (!isGitHubRateLimitResponse(response)) return null;

    return "GitHub API rate limit exceeded.";
}

export function mapGitHubResponseToError(response: Response): GitHubErrorMapping | null {
    if (response.status === 404) {
        return {
            status: 404,
            code: "repo_not_found",
            message: "Repository not found. Check the URL, or it may be private."
        };
    }

    if (response.status === 401) {
        return {
            status: 401,
            code: "github_auth_failed",
            message: "The GitHub token is invalid. Check GITHUB_TOKEN in .env."
        };
    }

    if (isGitHubRateLimitResponse(response)) {
        const retryAfterSeconds = getGitHubRateLimitResetSeconds(response);
        const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
        return {
            status: 429,
            code: "github_rate_limited",
            message: `GitHub rate limit reached. Try again in ${minutes} minutes. Adding a GITHUB_TOKEN to .env raises the limit.`,
            retryAfterSeconds
        };
    }

    if (!response.ok) {
        return {
            status: response.status >= 500 ? 502 : response.status,
            code: "api_failure",
            message: "GitHub API request failed."
        };
    }

    return null;
}

export function mapGitHubFetchError(error: unknown): GitHubErrorMapping {
    return {
        status: 502,
        code: "github_unreachable",
        message: "Cannot reach GitHub. Check your internet connection."
    };
}
