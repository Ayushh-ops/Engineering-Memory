import assert from "node:assert/strict";
import {
    GitHubRepositoryFileClient,
    GitHubRepositoryFileError
} from "./repository-file-client";

async function main(): Promise<void> {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    const client = new GitHubRepositoryFileClient();

    try {
        globalThis.fetch = async (input) => {
            requests.push(String(input));
            return new Response(JSON.stringify({
                type: "file",
                encoding: "base64",
                content: Buffer.from("export const answer = 42;").toString("base64")
            }), { status: 200 });
        };

        const files = await client.loadFiles(
            "example",
            "repository",
            ["src/auth.ts", "src/user.ts"],
            "abc123"
        );
        assert.deepEqual(files.map((file) => file.path), ["src/auth.ts", "src/user.ts"]);
        assert.equal(files[0]?.content, "export const answer = 42;");
        assert.deepEqual(requests, [
            "https://api.github.com/repos/example/repository/contents/src/auth.ts?ref=abc123",
            "https://api.github.com/repos/example/repository/contents/src/user.ts?ref=abc123"
        ]);

        const cases: Array<{ status: number; headers?: Record<string, string>; code: string }> = [
            { status: 404, code: "not_found" },
            { status: 403, headers: { "x-ratelimit-remaining": "0" }, code: "rate_limit" },
            { status: 500, code: "api_failure" }
        ];

        for (const testCase of cases) {
            globalThis.fetch = async () => new Response("{}", {
                status: testCase.status,
                headers: testCase.headers
            });
            await assert.rejects(
                () => client.loadFile("example", "repository", "src/file.ts", "abc123"),
                (error: unknown) => error instanceof GitHubRepositoryFileError && error.code === testCase.code
            );
        }

        globalThis.fetch = async () => new Response(JSON.stringify([{ type: "file" }]), { status: 200 });
        await assert.rejects(
            () => client.loadFile("example", "repository", "src", "abc123"),
            (error: unknown) => error instanceof GitHubRepositoryFileError && error.code === "not_file"
        );

        globalThis.fetch = async () => { throw new Error("network down"); };
        await assert.rejects(
            () => client.loadFile("example", "repository", "src/file.ts", "abc123"),
            (error: unknown) => error instanceof GitHubRepositoryFileError && error.code === "network_failure"
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    console.log("GitHub repository file client fixtures passed");
}

void main();
