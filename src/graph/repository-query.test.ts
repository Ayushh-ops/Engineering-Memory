import assert from "node:assert/strict";
import type { RepositoryGraph } from "./repository-graph";
import { queryRepositoryGraph } from "./repository-query";

const graph: RepositoryGraph = {
    nodes: [
        { id: "repository:example", type: "repository", name: "example" },
        { id: "file:src%2Fapp.ts", type: "file", name: "src/app.ts", path: "src/app.ts" },
        { id: "class:src%2Fapp.ts:App", type: "class", name: "App", path: "src/app.ts" },
        { id: "method:src%2Fapp.ts:App.run", type: "method", name: "App.run", path: "src/app.ts" },
        { id: "function:src%2Fapp.ts:load", type: "function", name: "load", path: "src/app.ts" },
        { id: "file:src%2Fuser.ts", type: "file", name: "src/user.ts", path: "src/user.ts" },
        { id: "function:src%2Fuser.ts:format", type: "function", name: "format", path: "src/user.ts" },
        { id: "file:src%2Fother.ts", type: "file", name: "src/other.ts", path: "src/other.ts" },
        { id: "commit:abc123", type: "commit", sha: "abc123", message: "Update app", authorName: "Ada", authorDate: "2026-08-22" },
        { id: "symbol-change:abc123:src%2Fapp.ts:function:load:modified", type: "symbol-change", name: "load", path: "src/app.ts", symbolType: "function", changeType: "modified" },
        { id: "file:src%2Fapp.ts", type: "file", name: "src/app.ts", path: "src/app.ts" },
        { id: "function:src%2Fuser.ts:format", type: "function", name: "format", path: "src/user.ts" }
    ],
    edges: [
        { from: "file:src%2Fapp.ts", to: "file:src%2Fuser.ts", type: "imports" },
        { from: "file:src%2Fother.ts", to: "file:src%2Fapp.ts", type: "imports" },
        { from: "function:src%2Fapp.ts:load", to: "function:src%2Fuser.ts:format", type: "calls" },
        { from: "commit:abc123", to: "file:src%2Fapp.ts", type: "changed" },
        { from: "commit:abc123", to: "symbol-change:abc123:src%2Fapp.ts:function:load:modified", type: "changed" },
        { from: "symbol-change:abc123:src%2Fapp.ts:function:load:modified", to: "function:src%2Fapp.ts:load", type: "affects" },
        { from: "file:src%2Fapp.ts", to: "file:src%2Fuser.ts", type: "imports" }
    ]
};

const originalGraph = JSON.stringify(graph);

assert.deepEqual(
    queryRepositoryGraph(graph, { type: "related-files", path: "src/app.ts" }).files.map((file) => file.path),
    ["src/user.ts", "src/other.ts"]
);
assert.deepEqual(
    queryRepositoryGraph(graph, { type: "file-symbols", path: "src/app.ts" }).symbols.map((symbol) => symbol.name),
    ["App", "App.run", "load"]
);
assert.deepEqual(
    queryRepositoryGraph(graph, { type: "file-imports", path: "src/app.ts" }).files.map((file) => file.path),
    ["src/user.ts"]
);
assert.deepEqual(
    queryRepositoryGraph(graph, {
        type: "symbol-callers",
        symbol: { type: "function", path: "src/user.ts", name: "format" }
    }).symbols.map((symbol) => symbol.name),
    ["load"]
);
assert.deepEqual(
    queryRepositoryGraph(graph, { type: "commit-changes", sha: "abc123" }),
    {
        files: [graph.nodes[1]],
        symbols: [],
        commits: [graph.nodes[8]],
        symbolChanges: [graph.nodes[9]]
    }
);
assert.deepEqual(
    queryRepositoryGraph(graph, { type: "commit-symbol-changes", sha: "abc123" }).symbolChanges,
    [graph.nodes[9]]
);
assert.deepEqual(
    queryRepositoryGraph(graph, { type: "affected-symbols", sha: "abc123" }).symbols,
    [graph.nodes[4]]
);

for (const query of [
    { type: "related-files", path: "missing.ts" } as const,
    { type: "file-symbols", path: "missing.ts" } as const,
    { type: "file-imports", path: "missing.ts" } as const,
    { type: "symbol-callers", symbol: { type: "function", path: "missing.ts", name: "missing" } } as const,
    { type: "commit-changes", sha: "missing" } as const,
    { type: "commit-symbol-changes", sha: "missing" } as const,
    { type: "affected-symbols", sha: "missing" } as const
]) {
    assert.deepEqual(queryRepositoryGraph(graph, query), {
        files: [],
        symbols: [],
        commits: [],
        symbolChanges: []
    });
}

assert.equal(JSON.stringify(graph), originalGraph);
console.log("repository graph query fixtures passed");
