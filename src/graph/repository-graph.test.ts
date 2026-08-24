import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import type { FileChangeAnalysis } from "../analyzers/typescript-history";
import { resolveRelativeImportRelationships, type RepositoryFileAnalysis } from "../resolvers/relative-imports";
import {
    buildRepositoryGraph,
    type RepositoryHistoricalChanges,
    type RepositoryHistoryCommit
} from "./repository-graph";

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
    graph.edges.filter((edge) => edge.type === "changed" && edge.to.startsWith("file:")),
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

const historicalChanges: FileChangeAnalysis[] = [
    {
        path: "src/account.ts",
        applicable: true,
        changes: [
            { type: "modified", symbolType: "class", name: "Account" },
            { type: "added", symbolType: "method", name: "Account.open" },
            { type: "modified", symbolType: "method", name: "Account.save" },
            { type: "removed", symbolType: "method", name: "Account.close" },
            { type: "added", symbolType: "function", name: "createAccount" },
            { type: "modified", symbolType: "function", name: "updateAccount" },
            { type: "removed", symbolType: "function", name: "deleteAccount" }
        ]
    },
    {
        path: "README.md",
        applicable: false,
        changes: [],
        reason: "Structural TypeScript diffing is only available for .ts and .tsx files."
    }
];

const historicalFiles: RepositoryFileAnalysis[] = [
    {
        path: "src/account.ts",
        analysis: analyzeTypeScript(
            "class Account { open() {} save() {} } function createAccount() {} function updateAccount() {}"
        )
    }
];

const historicalGraphInput: RepositoryHistoricalChanges = {
    sha: "abc123",
    files: historicalChanges
};

const historicalGraph = buildRepositoryGraph(
    "example/repository",
    historicalFiles,
    [],
    history,
    historicalGraphInput
);

const symbolChanges = historicalGraph.nodes.filter((node) => node.type === "symbol-change");
assert.equal(symbolChanges.length, 7);
assert.deepEqual(
    symbolChanges.map((node) => node.id),
    [
        "symbol-change:abc123:src%2Faccount.ts:class:Account:modified",
        "symbol-change:abc123:src%2Faccount.ts:method:Account.open:added",
        "symbol-change:abc123:src%2Faccount.ts:method:Account.save:modified",
        "symbol-change:abc123:src%2Faccount.ts:method:Account.close:removed",
        "symbol-change:abc123:src%2Faccount.ts:function:createAccount:added",
        "symbol-change:abc123:src%2Faccount.ts:function:updateAccount:modified",
        "symbol-change:abc123:src%2Faccount.ts:function:deleteAccount:removed"
    ]
);
assert.equal(
    new Set(symbolChanges.map((node) => node.id)).size,
    symbolChanges.length
);
assert.deepEqual(
    historicalGraph.edges.filter((edge) => edge.type === "in-file"),
    symbolChanges.map((node) => ({
        from: node.id,
        to: "file:src%2Faccount.ts",
        type: "in-file"
    }))
);
assert.equal(
    historicalGraph.edges.filter((edge) => edge.type === "changed" && edge.to.startsWith("symbol-change:")).length,
    7
);
assert.ok(historicalGraph.edges.some((edge) =>
    edge.type === "affects" &&
    edge.from === "symbol-change:abc123:src%2Faccount.ts:class:Account:modified" &&
    edge.to === "class:src%2Faccount.ts:Account"
));
assert.ok(historicalGraph.edges.some((edge) =>
    edge.type === "affects" &&
    edge.from === "symbol-change:abc123:src%2Faccount.ts:method:Account.open:added" &&
    edge.to === "method:src%2Faccount.ts:Account.open"
));
assert.ok(historicalGraph.edges.some((edge) =>
    edge.type === "affects" &&
    edge.from === "symbol-change:abc123:src%2Faccount.ts:function:createAccount:added" &&
    edge.to === "function:src%2Faccount.ts:createAccount"
));
assert.ok(!historicalGraph.nodes.some((node) =>
    node.type === "method" && node.name === "Account.close"
));
assert.ok(!historicalGraph.nodes.some((node) =>
    node.type === "function" && node.name === "deleteAccount"
));
assert.ok(!historicalGraph.nodes.some((node) => node.type === "symbol-change" && node.path === "README.md"));

const duplicateHistoricalGraph = buildRepositoryGraph(
    "example/repository",
    historicalFiles,
    [],
    history,
    { sha: "abc123", files: [...historicalChanges, ...historicalChanges] }
);
assert.equal(
    duplicateHistoricalGraph.nodes.filter((node) => node.type === "symbol-change").length,
    7
);
assert.equal(
    duplicateHistoricalGraph.edges.filter((edge) => edge.type === "in-file").length,
    7
);

console.log("repository graph history fixture passed");
