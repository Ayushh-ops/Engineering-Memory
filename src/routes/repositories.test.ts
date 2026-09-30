import assert from "node:assert/strict";
import express from "express";
import repositoriesRouter from "./repositories";

interface EndpointResult {
    status: number;
    body: Record<string, unknown>;
}

async function startServer(): Promise<{ port: number; close: () => void }> {
    const app = express();
    app.use(express.json());
    app.use("/api", repositoriesRouter);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    return {
        port: (server.address() as { port: number }).port,
        close: () => server.close()
    };
}

function request(port: number, path: string, body: unknown): Promise<EndpointResult> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }).then(async (response) => ({
        status: response.status,
        body: await response.json() as Record<string, unknown>
    }));
}

async function main(): Promise<void> {
    const server = await startServer();
    const port = server.port;

    const originalFetch = globalThis.fetch;
    process.env.GITHUB_TOKEN = "fake-token";

    try {
        // Test: valid tree response, filtered source files and ordering
        globalThis.fetch = async (url, options) => {
            if (url.toString().includes("github.com")) {
                if (url.toString().includes("/git/trees/abcdef123?recursive=1")) {
                    return {
                        status: 200,
                        ok: true,
                        headers: new Headers(),
                        json: async () => ({
                            sha: "abcdef123",
                            url: "some-url",
                            truncated: true,
                            tree: [
                                { path: "src/Z.ts", type: "blob" },
                                { path: "src/A.tsx", type: "blob" },
                                { path: "images/logo.png", type: "blob" },
                                { path: "src/node_modules/index.ts", type: "blob" },
                                { path: "dist/bundle.js", type: "blob" },
                                { path: "src", type: "tree" }
                            ]
                        })
                    } as unknown as Response;
                }
                return { status: 404, ok: false, headers: new Headers() } as unknown as Response;
            }
            return originalFetch(url, options); // Pass through other fetches like the local server
        };

        const res1 = await request(port, "/api/repositories/tree", { url: "https://github.com/owner/repo", sha: "abcdef123" });
        assert.equal(res1.status, 200);
        assert.equal(res1.body.repository, "owner/repo");
        assert.equal(res1.body.sha, "abcdef123");
        assert.equal(res1.body.truncated, true);
        assert.deepEqual(res1.body.files, [
            "dist/bundle.js",
            "images/logo.png",
            "src/A.tsx",
            "src/Z.ts",
            "src/node_modules/index.ts"
        ]);

        // Test: missing URL
        const res2 = await request(port, "/api/repositories/tree", { sha: "abcdef123" });
        assert.equal(res2.status, 400);

        // Test: Rate limit
        globalThis.fetch = async (url, options) => {
            if (url.toString().includes("github.com")) {
                const headers = new Headers();
                headers.set("x-ratelimit-remaining", "0");
                return {
                    status: 403,
                    ok: false,
                    headers
                } as unknown as Response;
            }
            return originalFetch(url, options);
        };
        const res3 = await request(port, "/api/repositories/tree", { url: "https://github.com/owner/repo", sha: "abcdef123" });
        assert.equal(res3.status, 429);

        // Test: empty tree
        globalThis.fetch = async (url, options) => {
            if (url.toString().includes("github.com")) {
                return {
                    status: 200,
                    ok: true,
                    headers: new Headers(),
                    json: async () => ({
                        sha: "abcdef123",
                        url: "some-url",
                        truncated: false,
                        tree: []
                    })
                } as unknown as Response;
            }
            return originalFetch(url, options);
        };
        const res4 = await request(port, "/api/repositories/tree", { url: "https://github.com/owner/repo", sha: "abcdef123" });
        assert.deepEqual(res4.body.files, []);

        // Test: analyze-file with Python source
        globalThis.fetch = async (url, options) => {
            if (url.toString().includes("github.com")) {
                if (url.toString().includes("/contents/calc.py")) {
                    return {
                        status: 200,
                        ok: true,
                        headers: new Headers(),
                        json: async () => ({
                            type: "file",
                            encoding: "base64",
                            content: Buffer.from("def add(a, b):\n    return a + b\n").toString("base64")
                        })
                    } as unknown as Response;
                }
                return { status: 404, ok: false, headers: new Headers() } as unknown as Response;
            }
            return originalFetch(url, options);
        };
        const resAnalyzePy = await request(port, "/api/repositories/analyze-file", {
            url: "https://github.com/owner/repo",
            sha: "abcdef123",
            path: "calc.py"
        });
        assert.equal(resAnalyzePy.status, 200);
        assert.equal((resAnalyzePy.body as Record<string, unknown>).path, "calc.py");
        const pyAnalysis = (resAnalyzePy.body as Record<string, unknown>).analysis as {
            functions: Array<{ name: string }>;
        };
        assert.deepEqual(
            pyAnalysis.functions.map((f) => f.name),
            ["add"]
        );

        // Test: analyze with multi-language files (Python and TypeScript)
        globalThis.fetch = async (url, options) => {
            if (url.toString().includes("github.com")) {
                if (url.toString().includes("/contents/calc.py")) {
                    return {
                        status: 200,
                        ok: true,
                        headers: new Headers(),
                        json: async () => ({
                            type: "file",
                            encoding: "base64",
                            content: Buffer.from("def add(a, b):\n    return a + b\n").toString("base64")
                        })
                    } as unknown as Response;
                }
                if (url.toString().includes("app.ts")) {
                    return {
                        status: 200,
                        ok: true,
                        headers: new Headers(),
                        json: async () => ({
                            type: "file",
                            encoding: "base64",
                            content: Buffer.from("export function run(): void {}").toString("base64")
                        })
                    } as unknown as Response;
                }
                return { status: 404, ok: false, headers: new Headers() } as unknown as Response;
            }
            return originalFetch(url, options);
        };
        const resAnalyzeMulti = await request(port, "/api/repositories/analyze", {
            url: "https://github.com/owner/repo",
            sha: "abcdef123",
            paths: ["calc.py", "src/app.ts"]
        });
        assert.equal(resAnalyzeMulti.status, 200);
        const multiFiles = (resAnalyzeMulti.body as Record<string, unknown>).files as Array<{
            path: string;
            analysis: { functions: Array<{ name: string }> };
        }>;
        assert.equal(multiFiles.length, 2);
        assert.equal(multiFiles[0].path, "calc.py");
        assert.equal(multiFiles[0].analysis.functions[0].name, "add");
        assert.equal(multiFiles[1].path, "src/app.ts");
        assert.equal(multiFiles[1].analysis.functions[0].name, "run");

        console.log("repositories route fixtures passed");
    } finally {
        globalThis.fetch = originalFetch;
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
