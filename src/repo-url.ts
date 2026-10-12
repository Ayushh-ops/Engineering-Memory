export interface ParsedGitHubRepo {
    valid: boolean;
    normalizedUrl?: string;
    owner?: string;
    repo?: string;
}

/**
 * Validates and normalizes GitHub repository input.
 * Accepts:
 * - https://github.com/<owner>/<repo> (optional .git, trailing slash, /tree/<branch>... or /blob/...)
 * - "owner/repo" shorthand
 */
export function parseGitHubRepoInput(raw: string): ParsedGitHubRepo {
    const trimmed = (raw || '').trim();
    if (!trimmed) return { valid: false };

    // Shorthand: "owner/repo" or "owner/repo.git" or "owner/repo/"
    const shorthandMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/);
    if (shorthandMatch && !trimmed.includes(':') && !trimmed.startsWith('http')) {
        const owner = shorthandMatch[1];
        const repo = shorthandMatch[2];
        if (owner && repo) {
            return {
                valid: true,
                normalizedUrl: `https://github.com/${owner}/${repo}`,
                owner,
                repo
            };
        }
    }

    try {
        let urlStr = trimmed;
        if (!/^https?:\/\//i.test(urlStr)) {
            urlStr = 'https://' + urlStr;
        }
        const parsed = new URL(urlStr);
        if (parsed.hostname.toLowerCase() !== 'github.com') {
            return { valid: false };
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
            return { valid: false };
        }
        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/, '');
        if (!owner || !repo) {
            return { valid: false };
        }
        return {
            valid: true,
            normalizedUrl: `https://github.com/${owner}/${repo}`,
            owner,
            repo
        };
    } catch {
        return { valid: false };
    }
}

export function isValidGitHubUrl(input: string): boolean {
    return parseGitHubRepoInput(input).valid;
}
