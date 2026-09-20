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
const impact = new ChangeImpactAnalysisService().analyze(graph, {
    type: "symbol",
    symbol: { type: "function", path: "src/order.ts", name: "calculateTotal" }
});
assert.equal(impact.paths.length, 1);
assert.deepEqual(impact.paths[0]?.nodes, [
    "function:src%2Forder.ts:calculateTotal",
    "function:src%2Forder.ts:saveOrder"
]);
assert.equal(impact.paths[0]?.depth, 1);
assert.equal(impact.paths[0]?.classification, "direct-caller");
assert.equal(impact.targetNodeId, "function:src%2Forder.ts:calculateTotal");
assert.deepEqual(impact.impactNodes, [
    {
        id: "function:src%2Forder.ts:calculateTotal",
        type: "function",
        path: "src/order.ts",
        name: "calculateTotal"
    },
    {
        id: "function:src%2Forder.ts:saveOrder",
        type: "function",
        path: "src/order.ts",
        name: "saveOrder"
    }
]);
for (const nodeId of impact.paths[0]?.nodes ?? []) {
    assert.equal(impact.impactNodes.filter((node) => node.id === nodeId).length, 1);
}
assert.equal(impact.paths[0]?.relationships[0]?.relationshipId, callEdges[0]?.id);
assert.equal(impact.paths[0]?.relationships[0]?.type, "calls");
assert.equal(impact.paths[0]?.relationships[0]?.evidence, "available");
assert.equal(impact.paths[0]?.relationships[0]?.callSiteIds.length, 2);
assert.ok(impact.paths[0]?.relationships[0]?.callSiteIds.every((id) => id.length > 0));
assert.deepEqual(impact.callSiteEvidence.map((evidence) => evidence.id), impact.paths[0]?.relationships[0]?.callSiteIds.slice().sort());
assert.deepEqual(impact.callSiteEvidence.map(({ id: _id, ...evidence }) => evidence), [
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

const converging = buildRepositoryGraph("example/repository", [
    analyzed("src/converging.ts", [
        "function target() {}",
        "function branchA() { target(); }",
        "function branchB() { target(); }",
        "function root() { branchA(); branchB(); }"
    ].join("\n"))
], []);
const convergingImpact = new ChangeImpactAnalysisService().analyze(converging, {
    type: "symbol",
    symbol: { type: "function", path: "src/converging.ts", name: "target" }
});
assert.deepEqual(convergingImpact.paths.map((path) => path.nodes.map((node) => node.split(":").at(-1))), [
    ["target", "branchA"],
    ["target", "branchB"],
    ["target", "branchA", "root"]
]);
assert.equal(convergingImpact.paths.filter((path) => path.nodes.at(-1)?.endsWith("root")).length, 1);
assert.deepEqual(convergingImpact.impactNodes.map((node) => node.id), [
    "function:src%2Fconverging.ts:target",
    "function:src%2Fconverging.ts:branchA",
    "function:src%2Fconverging.ts:branchB",
    "function:src%2Fconverging.ts:root"
]);
assert.equal(convergingImpact.impactNodes.length, new Set(convergingImpact.impactNodes.map((node) => node.id)).size);
const rootPath = convergingImpact.paths.find((path) => path.nodes.at(-1)?.endsWith("root"));
assert.ok(rootPath);
assert.deepEqual(rootPath.nodes, [
    "function:src%2Fconverging.ts:target",
    "function:src%2Fconverging.ts:branchA",
    "function:src%2Fconverging.ts:root"
]);
assert.deepEqual(rootPath.relationships.map((relationship) => ({
    relationshipId: relationship.relationshipId,
    from: relationship.from,
    to: relationship.to,
    callSiteIds: relationship.callSiteIds,
    type: relationship.type,
    evidence: relationship.evidence
})), [
    {
        relationshipId: calls(converging).find((edge) => edge.from.endsWith("branchA"))?.id,
        from: "function:src%2Fconverging.ts:branchA",
        to: "function:src%2Fconverging.ts:target",
        callSiteIds: rootPath.relationships[0]?.callSiteIds,
        type: "calls",
        evidence: "available"
    },
    {
        relationshipId: calls(converging).find((edge) => edge.from.endsWith("root"))?.id,
        from: "function:src%2Fconverging.ts:root",
        to: "function:src%2Fconverging.ts:branchA",
        callSiteIds: rootPath.relationships[1]?.callSiteIds,
        type: "calls",
        evidence: "available"
    }
]);
assert.ok(rootPath.relationships.every((relationship) => relationship.callSiteIds.length === 1));
for (const relationship of rootPath.relationships) {
    for (const evidenceId of relationship.callSiteIds) {
        assert.ok(convergingImpact.callSiteEvidence.some((evidence) => evidence.id === evidenceId));
    }
}

const convergingAgain = new ChangeImpactAnalysisService().analyze(converging, {
    type: "symbol",
    symbol: { type: "function", path: "src/converging.ts", name: "target" }
});
assert.equal(JSON.stringify(convergingImpact.paths), JSON.stringify(convergingAgain.paths));
assert.equal(JSON.stringify(convergingImpact.callSiteEvidence), JSON.stringify(convergingAgain.callSiteEvidence));
assert.equal(JSON.stringify(convergingImpact.impactNodes), JSON.stringify(convergingAgain.impactNodes));

const boundedImpact = new ChangeImpactAnalysisService().analyze(converging, {
    type: "symbol",
    symbol: { type: "function", path: "src/converging.ts", name: "target" }
}, { maxDepth: 1, maxResults: 10 });
assert.deepEqual(boundedImpact.paths.map((path) => path.depth), [1, 1]);
assert.equal(boundedImpact.bounds.truncated, true);
const maxResultsImpact = new ChangeImpactAnalysisService().analyze(converging, {
    type: "symbol",
    symbol: { type: "function", path: "src/converging.ts", name: "target" }
}, { maxResults: 1 });
assert.equal(maxResultsImpact.paths.length, 1);
assert.equal(maxResultsImpact.directCallers.length + maxResultsImpact.transitiveConsumers.length, 1);
assert.equal(maxResultsImpact.bounds.truncated, true);

const emptyEvidence = new ChangeImpactAnalysisService().analyze({
    nodes: [
        { id: "function:empty-target", type: "function", name: "target", path: "src/empty.ts" },
        { id: "function:empty-caller", type: "function", name: "caller", path: "src/empty.ts" }
    ],
    edges: [{
        id: "edge:calls:function%3Aempty-caller:function%3Aempty-target",
        from: "function:empty-caller",
        to: "function:empty-target",
        type: "calls",
        callSites: []
    }]
}, {
    type: "symbol",
    symbol: { type: "function", path: "src/empty.ts", name: "target" }
});
assert.deepEqual(emptyEvidence.paths[0]?.relationships[0]?.callSiteIds, []);
assert.equal(emptyEvidence.paths[0]?.relationships[0]?.type, "calls");
assert.equal(emptyEvidence.paths[0]?.relationships[0]?.evidence, "unavailable");
assert.deepEqual(emptyEvidence.callSiteEvidence, []);
assert.deepEqual(emptyEvidence.impactNodes.map((node) => node.id), [
    "function:empty-target",
    "function:empty-caller"
]);
assert.ok(emptyEvidence.limitations.some((limitation) => limitation.includes("call-site evidence")));

const legacyPath = new ChangeImpactAnalysisService().analyze({
    nodes: [
        { id: "function:legacy-target", type: "function", name: "target", path: "src/legacy.ts" },
        { id: "function:legacy-caller", type: "function", name: "caller", path: "src/legacy.ts" }
    ],
    edges: [{
        from: "function:legacy-caller",
        to: "function:legacy-target",
        type: "calls"
    }]
}, {
    type: "symbol",
    symbol: { type: "function", path: "src/legacy.ts", name: "target" }
});
assert.equal(legacyPath.paths[0]?.relationships[0]?.callSiteIds.length, 0);
assert.equal(legacyPath.paths[0]?.relationships[0]?.type, "calls");
assert.equal(legacyPath.paths[0]?.relationships[0]?.evidence, "unavailable");
assert.deepEqual(legacyPath.callSiteEvidence, []);
assert.ok(legacyPath.limitations.some((limitation) => limitation.includes("call-site evidence")));

const missingTarget = new ChangeImpactAnalysisService().analyze({ nodes: [], edges: [] }, {
    type: "symbol",
    symbol: { type: "function", path: "src/missing.ts", name: "missing" }
});
assert.equal(missingTarget.status, "missing");
assert.equal(missingTarget.targetNodeId, undefined);
assert.deepEqual(missingTarget.impactNodes, []);

const ambiguousTarget = new ChangeImpactAnalysisService().analyze({
    nodes: [
        { id: "function:duplicate-one", type: "function", name: "duplicate", path: "src/duplicate.ts" },
        { id: "function:duplicate-two", type: "function", name: "duplicate", path: "src/duplicate.ts" }
    ],
    edges: []
}, {
    type: "symbol",
    symbol: { type: "function", path: "src/duplicate.ts", name: "duplicate" }
});
assert.equal(ambiguousTarget.status, "ambiguous");
assert.equal(ambiguousTarget.targetNodeId, undefined);
assert.deepEqual(ambiguousTarget.impactNodes, []);

const fileTarget = new ChangeImpactAnalysisService().analyze({
    nodes: [{ id: "file:src%2Ftarget.ts", type: "file", name: "src/target.ts", path: "src/target.ts" }],
    edges: []
}, { type: "file", path: "src/target.ts" });
assert.equal(fileTarget.status, "ok");
assert.equal(fileTarget.targetNodeId, undefined);
assert.deepEqual(fileTarget.impactNodes, []);

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
