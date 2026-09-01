import assert from "node:assert/strict";
import { RepositoryAnalysisService } from "./repository-analysis-service";

const service = new RepositoryAnalysisService();

const result = service.analyzeFiles(
    { owner: "example", repository: "repository" },
    "abc123",
    [
        {
            path: "src/auth.ts",
            content: "import { formatUser } from './user'; export function auth() { return formatUser(); } export function validate() { return true; }"
        },
        {
            path: "src/user.ts",
            content: "export function formatUser() { return 'user'; }"
        }
    ]
);

assert.deepEqual(
    result.files.map((file: { path: string }) => file.path),
    ["src/auth.ts", "src/user.ts"]
);
assert.deepEqual(
    result.resolvedRelationships,
    [{ type: "imports", from: "src/auth.ts", to: "src/user.ts" }]
);
assert.ok(
    result.graph.nodes.some((node: { type: string; path?: string }) => node.type === "file" && node.path === "src/auth.ts")
);
assert.ok(
    result.graph.nodes.some((node: { type: string; path?: string }) => node.type === "file" && node.path === "src/user.ts")
);
assert.ok(
    result.graph.edges.some(
        (edge: { type: string; from: string; to: string }) => edge.type === "imports" && edge.from === "file:src%2Fauth.ts" && edge.to === "file:src%2Fuser.ts"
    )
);
assert.ok(
    result.graph.nodes.some((node: { type: string; name?: string }) => node.type === "function" && node.name === "auth")
);
assert.ok(
    result.graph.nodes.some((node: { type: string; name?: string }) => node.type === "function" && node.name === "formatUser")
);

const historyResult = service.analyzeHistoricalFiles(
    { owner: "example", repository: "repository" },
    "abc123",
    "def456",
    [
        {
            path: "src/auth.ts",
            parentContent: "function auth() { return true; }",
            currentContent: "export function auth() { return true; }"
        },
        {
            path: "src/user.ts",
            parentContent: "export function formatUser() { return 'user'; }",
            currentContent: "export function formatUser() { return 'user'; }"
        }
    ],
    [
        {
            sha: "def456",
            message: "Update auth",
            authorName: "Ada Lovelace",
            authorDate: "2026-08-22T00:00:00Z",
            files: [{ filename: "src/auth.ts" }]
        }
    ],
    {
        sha: "abc123",
        files: [
            {
                path: "src/auth.ts",
                applicable: true,
                changes: [{ type: "modified", symbolType: "function", name: "auth" }]
            }
        ]
    }
);

assert.equal(historyResult.files.length, 2);
assert.equal(historyResult.parentSha, "def456");
assert.ok(historyResult.graph.nodes.some((node: { type: string }) => node.type === "symbol-change"));

console.log("repository analysis service fixture passed");
