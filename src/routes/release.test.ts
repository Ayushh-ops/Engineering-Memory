import assert from "node:assert/strict";
import express from "express";
import { parseGitHubRepoInput } from "../repo-url";
import { mapGitHubResponseToError, mapGitHubFetchError } from "../github/client";
import repositoriesRouter from "./repositories";
import aiRouter from "./ai";

interface EndpointResult {
    status: number;
    body: Record<string, unknown>;
}

async function startServer(): Promise<{ port: number; close: () => void }> {
    const app = express();
    app.use(express.json());
    app.use("/api", repositoriesRouter);
    app.use("/api", aiRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    return {
        port: (server.address() as { port: number }).port,
        close: () => server.close()
    };
}

const originalFetch = globalThis.fetch;

function postJson(port: number, path: string, body: unknown): Promise<EndpointResult> {
    return originalFetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }).then(async (response) => ({
        status: response.status,
        body: await response.json() as Record<string, unknown>
    }));
}

async function main(): Promise<void> {
    // ------------------------------------------------------------------------
    // Test 1: Client URL validation table (valid and invalid inputs)
    // ------------------------------------------------------------------------
    const validInputs = [
        "https://github.com/facebook/react",
        "https://github.com/facebook/react.git",
        "https://github.com/facebook/react/",
        "https://github.com/facebook/react/tree/main/packages",
        "https://github.com/facebook/react/blob/main/README.md",
        "facebook/react",
        "facebook/react.git",
        "facebook/react/"
    ];

    for (const input of validInputs) {
        const parsed = parseGitHubRepoInput(input);
        assert.equal(parsed.valid, true, `Expected "${input}" to be valid`);
        assert.equal(parsed.normalizedUrl, "https://github.com/facebook/react");
        assert.equal(parsed.owner, "facebook");
        assert.equal(parsed.repo, "react");
    }

    const invalidInputs = [
        "",
        "   ",
        "not-a-repo",
        "https://gitlab.com/facebook/react",
        "https://github.com/",
        "https://github.com/facebook",
        "facebook",
        "http:///"
    ];

    for (const input of invalidInputs) {
        const parsed = parseGitHubRepoInput(input);
        assert.equal(parsed.valid, false, `Expected "${input}" to be invalid`);
    }

    // ------------------------------------------------------------------------
    // Test 2: GitHub status to code mapping
    // ------------------------------------------------------------------------
    // 404 -> repo_not_found
    const res404 = new Response("Not Found", { status: 404 });
    const err404 = mapGitHubResponseToError(res404);
    assert.ok(err404);
    assert.equal(err404.status, 404);
    assert.equal(err404.code, "repo_not_found");
    assert.equal(err404.message, "Repository not found. Check the URL, or it may be private.");

    // 403 with rate limit headers -> github_rate_limited
    const resetTime = Math.floor(Date.now() / 1000) + 180;
    const res403Rate = new Response("Forbidden", {
        status: 403,
        headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetTime)
        }
    });
    const err403Rate = mapGitHubResponseToError(res403Rate);
    assert.ok(err403Rate);
    assert.equal(err403Rate.status, 429);
    assert.equal(err403Rate.code, "github_rate_limited");
    assert.ok(err403Rate.message.includes("GitHub rate limit reached"));
    assert.ok(typeof err403Rate.retryAfterSeconds === "number");

    // 401 -> github_auth_failed
    const res401 = new Response("Unauthorized", { status: 401 });
    const err401 = mapGitHubResponseToError(res401);
    assert.ok(err401);
    assert.equal(err401.status, 401);
    assert.equal(err401.code, "github_auth_failed");
    assert.equal(err401.message, "The GitHub token is invalid. Check GITHUB_TOKEN in .env.");

    // Network error / timeout -> github_unreachable
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const unreachableErr = mapGitHubFetchError(abortError);
    assert.equal(unreachableErr.status, 502);
    assert.equal(unreachableErr.code, "github_unreachable");
    assert.equal(unreachableErr.message, "Cannot reach GitHub. Check your internet connection.");

    // ------------------------------------------------------------------------
    // Server-based tests
    // ------------------------------------------------------------------------
    const server = await startServer();
    const port = server.port;

    try {
        // --------------------------------------------------------------------
        // Test 3: Greeting answered with the fetcher mocked to throw
        // --------------------------------------------------------------------
        globalThis.fetch = async () => {
            throw new Error("Unable to reach the GitHub API (fetcher threw)");
        };

        const greetingRes = await postJson(port, "/api/ai/ask-repository", {
            url: "https://github.com/facebook/react",
            sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            paths: ["src/index.ts"],
            target: { type: "file", path: "src/index.ts" },
            question: "hello"
        });

        assert.equal(greetingRes.status, 200);
        assert.equal(greetingRes.body.status, "ok");
        assert.ok(typeof greetingRes.body.answer === "string");
        assert.ok((greetingRes.body.answer as string).toLowerCase().includes("hello"));

        // --------------------------------------------------------------------
        // Test 4: Analyze error path returns JSON quickly
        // --------------------------------------------------------------------
        globalThis.fetch = async () => {
            return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
        };

        const startTime = Date.now();
        const analyzeRes = await postJson(port, "/api/repositories/analyze", {
            url: "https://github.com/facebook/nonexistent-repo",
            sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            paths: ["src/index.ts"]
        });
        const duration = Date.now() - startTime;

        assert.equal(analyzeRes.status, 404);
        assert.equal(analyzeRes.body.code, "repo_not_found");
        assert.ok(typeof analyzeRes.body.message === "string");
        assert.ok(duration < 2000, `Analyze error took ${duration}ms, expected < 2000ms`);

        // --------------------------------------------------------------------
        // Test 5: The file-fetch failure falls back to facts with the one-sentence note
        // --------------------------------------------------------------------
        globalThis.fetch = async () => {
            throw new Error("Cannot connect to GitHub API");
        };

        const factsQuestionRes = await postJson(port, "/api/ai/ask-repository", {
            url: "https://github.com/facebook/react",
            sha: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
            paths: ["src/index.ts"],
            target: { type: "file", path: "src/index.ts" },
            question: "What does this file do and what are its dependencies?",
            risk: { score: 65, level: "high" },
            dependents: ["src/App.tsx", "src/main.tsx"],
            owners: { owners: [{ name: "Alice", count: 10, share: 70 }] },
            recentCommits: [
                { sha: "abc1234", message: "refactor: update index", author: "Alice", date: "2026-01-01" }
            ]
        });

        assert.equal(factsQuestionRes.status, 200);
        assert.equal(factsQuestionRes.body.status, "ok");
        assert.ok(Array.isArray(factsQuestionRes.body.missingData));
        assert.ok((factsQuestionRes.body.missingData as string[]).includes("file_content_unavailable"));

        const answerText = String(factsQuestionRes.body.answer || "");
        assert.ok(
            answerText.startsWith("The file content could not be loaded from GitHub."),
            `Expected answer to start with the one-sentence note, but got: "${answerText.slice(0, 100)}..."`
        );
        assert.ok(answerText.includes("Score is 65 (high)"));
        assert.ok(answerText.includes("Dependents"));
        assert.ok(answerText.includes("src/App.tsx"));
    } finally {
        globalThis.fetch = originalFetch;
        server.close();
    }

    console.log("Release polish tests passed successfully.");
}

main().catch((err) => {
    console.error("Release test failure:", err);
    process.exit(1);
});
