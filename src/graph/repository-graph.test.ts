import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships, type RepositoryFileAnalysis } from "../resolvers/relative-imports";
import { buildRepositoryGraph, type RepositoryHistoryCommit } from "./repository-graph";

const files: RepositoryFileAnalysis[] = [
    {
        path: "src/auth.ts",
        analysis: analyzeTypeScript("import { formatUser } from './user'; function validate() { return true; } export function authenticate() { validate(); return formatUser(); }")
    },
    {
        path: "src/user.ts",
        analysis: analyzeTypeScript("export function formatUser() { return 'user'; }")
    }
];

const history: RepositoryHistoryCommit[] = [
    {
        sha: "abc123",
        message: "Add authentication",
        authorName: "Ada Lovelace",
        authorDate: "2026-08-22T00:00:00Z",
        files: [{ filename: "src/auth.ts" }, { filename: "src/user.ts" }, { filename: "README.md" }]
    },
    {
        sha: "abc123",
        message: "Duplicate data is ignored",
        authorName: "Ada Lovelace",
        authorDate: "2026-08-22T00:00:00Z",
        files: [{ filename: "src/auth.ts" }]
    }
];

const graph = buildRepositoryGraph(
    "example/repository",
    files,
    resolveRelativeImportRelationships(files),
    history
);

assert.ok(graph.nodes.some((node) => node.id === "repository:example%2Frepository"));
assert.ok(graph.nodes.some((node) => node.type === "file" && node.path === "src/auth.ts"));
assert.ok(graph.nodes.some((node) => node.type === "file" && node.path === "src/user.ts"));
assert.deepEqual(graph.nodes.filter((node) => node.type === "commit"), [{
    id: "commit:abc123",
    type: "commit",
    sha: "abc123",
    message: "Add authentication",
    authorName: "Ada Lovelace",
    authorDate: "2026-08-22T00:00:00Z"
}]);
assert.deepEqual(
    graph.edges.filter((edge) => edge.type === "changed"),
    [
        { from: "commit:abc123", to: "file:src%2Fauth.ts", type: "changed" },
        { from: "commit:abc123", to: "file:src%2Fuser.ts", type: "changed" }
    ]
);
assert.ok(graph.edges.some((edge) => edge.type === "contains"));
assert.ok(graph.edges.some((edge) => edge.type === "imports"));
assert.ok(graph.edges.some((edge) => edge.type === "calls"));
assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
assert.equal(
    new Set(graph.edges.map((edge) => `${edge.type}\u0000${edge.from}\u0000${edge.to}`)).size,
    graph.edges.length
);

console.log("repository graph history fixture passed");
