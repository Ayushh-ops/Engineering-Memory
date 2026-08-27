import assert from "node:assert/strict";
import {
    getGitHubRateLimitError,
    getGitHubRequestOptions,
    isGitHubRateLimitResponse
} from "./client";

const originalToken = process.env.GITHUB_TOKEN;

try {
    delete process.env.GITHUB_TOKEN;
    const unauthenticatedHeaders = getGitHubRequestOptions().headers as Record<string, string>;
    assert.deepEqual(unauthenticatedHeaders, {
        Accept: "application/vnd.github+json"
    });

    process.env.GITHUB_TOKEN = "test-token";
    const authenticatedHeaders = getGitHubRequestOptions().headers as Record<string, string>;
    assert.deepEqual(authenticatedHeaders, {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer test-token"
    });

    const successfulResponse = new Response("{}", { status: 200 });
    assert.equal(isGitHubRateLimitResponse(successfulResponse), false);
    assert.equal(getGitHubRateLimitError(successfulResponse), null);

    const rateLimitResponse = new Response("{}", {
        status: 403,
        headers: {
            "x-ratelimit-limit": "60",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": "1798400000"
        }
    });
    const rateLimitError = getGitHubRateLimitError(rateLimitResponse);
    assert.equal(isGitHubRateLimitResponse(rateLimitResponse), true);
    assert.ok(rateLimitError?.startsWith("GitHub API rate limit exceeded."));
    assert.ok(!rateLimitError?.includes("test-token"));
    assert.ok(!JSON.stringify({ error: rateLimitError }).includes("test-token"));

    const tooManyRequestsResponse = new Response("{}", { status: 429 });
    assert.equal(isGitHubRateLimitResponse(tooManyRequestsResponse), true);
    assert.equal(getGitHubRateLimitError(tooManyRequestsResponse), "GitHub API rate limit exceeded.");
} finally {
    if (originalToken === undefined) {
        delete process.env.GITHUB_TOKEN;
    } else {
        process.env.GITHUB_TOKEN = originalToken;
    }
}

console.log("GitHub client fixtures passed");
