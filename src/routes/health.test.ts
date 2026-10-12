import assert from "node:assert/strict";
import app from "../app";

async function startServer(): Promise<{ port: number; close: () => void }> {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    return {
        port: (server.address() as { port: number }).port,
        close: () => server.close()
    };
}

async function main(): Promise<void> {
    const server = await startServer();
    const port = server.port;

    try {
        // 2 MB padding (2 * 1024 * 1024 bytes)
        const twoMbPadding = "a".repeat(2 * 1024 * 1024);

        // 1. A 2 MB JSON body to the health route is accepted (30mb limit)
        const healthPayload = {
            graph: {
                nodes: [
                    { id: "repo:1", type: "repository", name: "test-repo" },
                    { id: "file:1", type: "file", name: "index.ts", path: "src/index.ts" }
                ],
                edges: []
            },
            padding: twoMbPadding
        };

        const healthRes = await fetch(`http://127.0.0.1:${port}/api/repositories/graph/health`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(healthPayload)
        });

        assert.equal(healthRes.status, 200, "Health route should accept 2 MB payload under 30mb limit");
        const healthBody = await healthRes.json() as Record<string, unknown>;
        assert.ok(Array.isArray(healthBody.circularImports), "Health body should contain circularImports");
        assert.ok(Array.isArray(healthBody.unusedFiles), "Health body should contain unusedFiles");
        assert.ok(Array.isArray(healthBody.godFiles), "Health body should contain godFiles");

        // 1b. Test unusedFiles exclusions vs valid product source file
        const exclusionPayload = {
            graph: {
                nodes: [
                    { id: "repo:1", type: "repository", name: "test-repo" },
                    { id: "file:1", type: "file", name: "waitForCdp.ts", path: ".agents/skills/launch/scripts/waitForCdp.ts" },
                    { id: "file:2", type: "file", name: "code-amd-node-module.ts", path: ".eslint-plugin-local/code-amd-node-module.ts" },
                    { id: "file:3", type: "file", name: "bar.ts", path: "src/vs/foo/bar.ts" }
                ],
                edges: []
            }
        };

        const exclusionRes = await fetch(`http://127.0.0.1:${port}/api/repositories/graph/health`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(exclusionPayload)
        });
        assert.equal(exclusionRes.status, 200, "Exclusion test request should succeed");
        const exclusionBody = await exclusionRes.json() as { unusedFiles: string[] };
        assert.ok(
            !exclusionBody.unusedFiles.includes(".agents/skills/launch/scripts/waitForCdp.ts"),
            "Files in .agents/skills/... must NOT be in unusedFiles"
        );
        assert.ok(
            !exclusionBody.unusedFiles.includes(".eslint-plugin-local/code-amd-node-module.ts"),
            "Files in .eslint-plugin-local/... must NOT be in unusedFiles"
        );
        assert.ok(
            exclusionBody.unusedFiles.includes("src/vs/foo/bar.ts"),
            "Real source file src/vs/foo/bar.ts with in-degree 0 MUST be in unusedFiles"
        );

        // 2. A 2 MB body to a normal route is rejected with a JSON 413 error
        const normalPayload = {
            padding: twoMbPadding
        };

        const normalRes = await fetch(`http://127.0.0.1:${port}/api/repositories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(normalPayload)
        });

        assert.equal(normalRes.status, 413, "Normal route should reject 2 MB payload with status 413");
        assert.ok(
            normalRes.headers.get("content-type")?.includes("application/json"),
            "Error response must be JSON, never HTML"
        );
        const errorBody = await normalRes.json() as Record<string, unknown>;
        assert.equal(errorBody.status, "error", "Status field in JSON error must be 'error'");
        assert.equal(errorBody.code, "payload_too_large", "Error code must be 'payload_too_large'");
        assert.ok(typeof errorBody.message === "string" && errorBody.message.length > 0, "Error must include message");

        console.log("health.test.ts passed");
    } finally {
        server.close();
    }
}

main().catch((err) => {
    console.error("health.test.ts failed:", err);
    process.exit(1);
});
