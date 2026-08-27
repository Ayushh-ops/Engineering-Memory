import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships } from "../resolvers/relative-imports";
import { buildRepositoryGraph, type RepositoryHistoryCommit } from "./repository-graph";
import { assembleRepositoryContext, type RepositoryContextRequest } from "./repository-context";

const files = [
    { path: "src/auth.ts", analysis: analyzeTypeScript("import { format } from './user'; export function anchor() { return true; } export function auth() { return format(); } export function invoke() { return auth(); } export function trigger() { return invoke(); }") },
    { path: "src/user.ts", analysis: analyzeTypeScript("export function format() { return 'user'; }") }
];
const history: RepositoryHistoryCommit[] = [{
    sha: "abc123", message: "Update auth", authorName: "Ada", authorDate: "2026-08-22", files: [{ filename: "src/auth.ts" }]
}];
const graph = buildRepositoryGraph(
    "example/repository",
    files,
    resolveRelativeImportRelationships(files),
    history,
    { sha: "abc123", files: [{ path: "src/auth.ts", applicable: true, changes: [{ type: "modified", symbolType: "function", name: "auth" }] }] }
);

const fileContext = assembleRepositoryContext(graph, { target: { type: "file", path: "src/auth.ts" } });
assert.equal(fileContext.status, "ok");
if (fileContext.status === "ok") {
    assert.deepEqual(fileContext.context.files.map((file) => file.path), ["src/auth.ts", "src/user.ts"]);
    assert.deepEqual(fileContext.context.commits.map((commit) => commit.sha), ["abc123"]);
    assert.deepEqual(fileContext.context.symbolChanges.map((change) => change.name), ["auth"]);
    assert.deepEqual(fileContext.context.imports.map((edge) => edge.to), ["file:src%2Fuser.ts"]);
}

const boundedFileContext = assembleRepositoryContext(graph, {
    target: { type: "file", path: "src/auth.ts" },
    limits: { maxSymbols: 1 }
});
assert.equal(boundedFileContext.status, "ok");
if (boundedFileContext.status === "ok") {
    assert.deepEqual(boundedFileContext.context.symbols.map((symbol) => symbol.name), ["anchor"]);
    assert.deepEqual(boundedFileContext.context.callers.map((symbol) => symbol.name), []);
}

const symbolRequest: RepositoryContextRequest = {
    target: { type: "symbol", symbol: { type: "function", path: "src/auth.ts", name: "auth" } }
};
const symbolContext = assembleRepositoryContext(graph, symbolRequest);
assert.equal(symbolContext.status, "ok");
if (symbolContext.status === "ok") {
    assert.deepEqual(symbolContext.context.callers.map((symbol) => symbol.name), ["invoke"]);
}

const commitContext = assembleRepositoryContext(graph, { target: { type: "commit", sha: "abc123" } });
assert.equal(commitContext.status, "ok");
if (commitContext.status === "ok") {
    assert.deepEqual(commitContext.context.files.map((file) => file.path), ["src/auth.ts"]);
    assert.deepEqual(commitContext.context.symbols.map((symbol) => symbol.name), ["auth"]);
}

assert.equal(assembleRepositoryContext(graph, { target: { type: "file", path: "missing.ts" } }).status, "missing");
assert.throws(() => assembleRepositoryContext(graph, {
    target: { type: "file", path: "src/auth.ts" },
    limits: { maxFiles: 51 }
}));
console.log("repository context fixtures passed");