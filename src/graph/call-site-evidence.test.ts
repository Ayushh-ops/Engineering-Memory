import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { resolveRelativeImportRelationships, type RepositoryFileAnalysis } from "../resolvers/relative-imports";
import { ChangeImpactAnalysisService } from "../services/change-impact-analysis-service";
import {
    buildRepositoryGraph,
    type RepositoryGraph,
    type RepositoryHistoricalChanges,
    type RepositoryHistoryCommit
} from "./repository-graph";

function analyzed(path: string, content: string): RepositoryFileAnalysis {
    return { path, analysis: analyzeTypeScript(content, path) };
}

function calls(graph: RepositoryGraph) {
    return graph.edges.filter((edge) => edge.type === "calls");
}

const saveOrder = analyzed("src/order.ts", [
    "function saveOrder() {",
    "    calculateTotal(items);",
    "    calculateTotal(discountedItems);",
    "}",
    "function calculateTotal(values: unknown[]) { return values.length; }"
].join("\n"));
const singleCallAnalysis = analyzeTypeScript(
    [
        "function saveOrder() {",
        "    calculateTotal(items);",
        "}",
        "function calculateTotal(items: unknown[]) { return items.length; }"
    ].join("\n"),
    "src/order.ts"
);
assert.deepEqual(singleCallAnalysis.relationships.filter((relationship) => relationship.type === "calls")[0]?.callSites, [{
    file: "src/order.ts",
    startLine: 2,
    startColumn: 5,
    endLine: 2,
    endColumn: 26,
    expression: "calculateTotal(items)"
}]);

const graph = buildRepositoryGraph("example/repository", [saveOrder], []);
const callEdges = calls(graph);
assert.equal(callEdges.length, 1);
assert.ok(callEdges[0]?.id);
assert.equal(callEdges[0]?.from, "function:src%2Forder.ts:saveOrder");
assert.equal(callEdges[0]?.to, "function:src%2Forder.ts:calculateTotal");
assert.deepEqual(callEdges[0]?.callSites, [
    {
        file: "src/order.ts",
        startLine: 2,
        startColumn: 5,
        endLine: 2,
        endColumn: 26,
        expression: "calculateTotal(items)"
    },
    {
        file: "src/order.ts",
        startLine: 3,
        startColumn: 5,
        endLine: 3,
        endColumn: 36,
        expression: "calculateTotal(discountedItems)"
    }
]);

const callers = buildRepositoryGraph("example/repository", [
    analyzed("src/a.ts", "function callerA() { target(); } function target() {}"),
    analyzed("src/b.ts", "function callerB() { target(); } function target() {}")
], []);
assert.equal(calls(callers).length, 2);
assert.deepEqual(calls(callers).map((edge) => ({
    caller: edge.from,
    callSites: edge.callSites
})), [
    {
        caller: "function:src%2Fa.ts:callerA",
        callSites: [{
            file: "src/a.ts",
            startLine: 1,
            startColumn: 22,
            endLine: 1,
            endColumn: 30,
            expression: "target()"
        }]
    },
    {
        caller: "function:src%2Fb.ts:callerB",
        callSites: [{
            file: "src/b.ts",
            startLine: 1,
            startColumn: 22,
            endLine: 1,
            endColumn: 30,
            expression: "target()"
        }]
    }
]);
const callersAgain = buildRepositoryGraph("example/repository", [
    analyzed("src/a.ts", "function callerA() { target(); } function target() {}"),
    analyzed("src/b.ts", "function callerB() { target(); } function target() {}")
], []);
assert.deepEqual(
    calls(callers).map((edge) => edge.id),
    calls(callersAgain).map((edge) => edge.id)
);

const oneFileMultipleCallers = buildRepositoryGraph("example/repository", [
    analyzed("src/callers.ts", "function callerA() { target(); } function callerB() { target(); } function target() {}")
], []);
assert.equal(calls(oneFileMultipleCallers).length, 2);
assert.deepEqual(calls(oneFileMultipleCallers).map((edge) => edge.from), [
    "function:src%2Fcallers.ts:callerA",
    "function:src%2Fcallers.ts:callerB"
]);

const recursive = buildRepositoryGraph("example/repository", [
    analyzed("src/walk.ts", "function walk() { walk(); }")
], []);
assert.equal(calls(recursive).length, 1);
assert.equal(calls(recursive)[0]?.from, calls(recursive)[0]?.to);
assert.equal(calls(recursive)[0]?.callSites?.length, 1);
const recursiveImpact = new ChangeImpactAnalysisService().analyze(recursive, {
    type: "symbol",
    symbol: { type: "function", path: "src/walk.ts", name: "walk" }
});
assert.deepEqual(recursiveImpact.directCallers, []);
assert.deepEqual(recursiveImpact.transitiveConsumers, []);

const unresolved = buildRepositoryGraph("example/repository", [
    analyzed("src/unresolved.ts", "function caller() { missing(); }")
], []);
assert.equal(calls(unresolved).length, 0);

const ambiguous = buildRepositoryGraph("example/repository", [
    analyzed("src/ambiguous.ts", "function caller() { duplicate(); } function duplicate() {} function duplicate() {}")
], []);
assert.equal(calls(ambiguous).length, 0);

const crossFileFiles = [
    analyzed("src/order.ts", "import { calculateTotal } from './pricing'; function createOrder() { calculateTotal(items); }"),
    analyzed("src/pricing.ts", "export function calculateTotal(items: unknown[]) { return items.length; }")
];
const crossFile = buildRepositoryGraph(
    "example/repository",
    crossFileFiles,
    resolveRelativeImportRelationships(crossFileFiles)
);
assert.equal(crossFile.edges.filter((edge) => edge.type === "imports").length, 1);
assert.equal(calls(crossFile).length, 0);

const history: RepositoryHistoryCommit[] = [{
    sha: "abc123",
    message: "Update order",
    authorName: "Ada",
    authorDate: "2026-09-20",
    files: [{ filename: "src/order.ts" }]
}];
const historicalChanges: RepositoryHistoricalChanges = {
    sha: "abc123",
    files: [{
        path: "src/order.ts",
        applicable: true,
        changes: [{ type: "modified", symbolType: "function", name: "saveOrder" }]
    }]
};
const allEdges = buildRepositoryGraph(
    "example/repository",
    [saveOrder],
    [],
    history,
    historicalChanges
).edges;
for (const edge of allEdges.filter((candidate) => candidate.type !== "calls")) {
    assert.equal(edge.id, undefined);
    assert.equal(edge.callSites, undefined);
}

console.log("call-site evidence fixtures passed");
