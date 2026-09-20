import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { buildRepositoryGraph, type RepositoryGraph } from "../graph/repository-graph";
import {
    ChangeImpactAnalysisService,
    type ChangeImpactAnalysisResult
} from "../services/change-impact-analysis-service";
import {
    RepositorySourceEvidenceService,
    type RepositorySourceEvidence
} from "../services/repository-source-evidence-service";
import { validateRepositoryContextConsistency } from "./consistency-validator";

const source = [
    "function saveOrder() {",
    "    calculateTotal(items);",
    "}",
    "function calculateTotal(values: unknown[]) { return values.length; }"
].join("\n");

const graph = buildRepositoryGraph(
    "example/repository",
    [{ path: "src/order.ts", analysis: analyzeTypeScript(source, "src/order.ts") }],
    []
);

const impactService = new ChangeImpactAnalysisService();
const targetSymbol = { type: "function" as const, path: "src/order.ts", name: "calculateTotal" };
const validImpact: ChangeImpactAnalysisResult = impactService.analyze(graph, {
    type: "symbol",
    symbol: targetSymbol
});
const validEvidence: RepositorySourceEvidence[] = new RepositorySourceEvidenceService().select(
    { type: "symbol", symbol: targetSymbol },
    graph,
    [{ path: "src/order.ts", content: source }]
);

function withImpact(overrides: Partial<ChangeImpactAnalysisResult>): ChangeImpactAnalysisResult {
    return { ...validImpact, ...overrides };
}

function expectInvalid(
    impact: ChangeImpactAnalysisResult,
    code: string,
    evidence: RepositorySourceEvidence[] = validEvidence
): void {
    const result = validateRepositoryContextConsistency({ graph, evidence, impact });
    assert.equal(result.status, "invalid");
    assert.ok(
        (result.missingData ?? []).includes(code),
        `expected ${code} in ${JSON.stringify(result.missingData)}`
    );
}

function expectInvalidFor(
    targetGraph: RepositoryGraph,
    evidence: RepositorySourceEvidence[],
    impact: ChangeImpactAnalysisResult,
    code: string
): void {
    const result = validateRepositoryContextConsistency({ graph: targetGraph, evidence, impact });
    assert.equal(result.status, "invalid");
    assert.ok(
        (result.missingData ?? []).includes(code),
        `expected ${code} in ${JSON.stringify(result.missingData)}`
    );
}
// Valid context
const validResult = validateRepositoryContextConsistency({ graph, evidence: validEvidence, impact: validImpact });
assert.equal(validResult.status, "ok");
assert.equal(validResult.missingData, undefined);

// Missing targetNodeId
expectInvalid(withImpact({ targetNodeId: "function:src%2Fghost.ts:ghost" }), "impact_target_node_missing");

// Missing path node
expectInvalid(withImpact({
    paths: validImpact.paths.map((path) => ({
        ...path,
        nodes: [...path.nodes, "function:src%2Fghost.ts:ghost"]
    }))
}), "path_node_missing");

// Missing relationship
expectInvalid(withImpact({
    paths: validImpact.paths.map((path) => ({
        ...path,
        relationships: path.relationships.map((relationship) => ({
            ...relationship,
            relationshipId: "edge:calls:missing"
        }))
    }))
}), "path_relationship_missing");

// Relationship metadata mismatch
expectInvalid(withImpact({
    paths: validImpact.paths.map((path) => ({
        ...path,
        relationships: path.relationships.map((relationship) => ({
            ...relationship,
            from: "function:src%2Fghost.ts:ghost"
        }))
    }))
}), "relationship_metadata_mismatch");

// Missing call-site
expectInvalid(withImpact({
    paths: validImpact.paths.map((path) => ({
        ...path,
        relationships: path.relationships.map((relationship) => ({
            ...relationship,
            callSiteIds: [...relationship.callSiteIds, "edge:calls:missing:src%2Fghost.ts:9:9:9:20:ghost()"]
        }))
    }))
}), "path_call_site_missing");

// Fabricated call-site evidence
expectInvalid(withImpact({
    callSiteEvidence: [{
        id: "edge:calls:missing:src%2Fghost.ts:9:9:9:20:ghost()",
        file: "src/ghost.ts",
        startLine: 9,
        startColumn: 9,
        endLine: 9,
        endColumn: 20,
        expression: "ghost()"
    }]
}), "fabricated_call_site_evidence");

// Call-site location mismatch: the citation ID resolves but the fields disagree
expectInvalid(withImpact({
    callSiteEvidence: validImpact.callSiteEvidence.map((entry) => ({ ...entry, file: "src/other.ts" }))
}), "call_site_location_mismatch");

// Call-site location mismatch: the fields exist in the graph but the citation ID does not
expectInvalid(withImpact({
    callSiteEvidence: validImpact.callSiteEvidence.map((entry) => ({ ...entry, id: "edge:calls:missing" }))
}), "call_site_location_mismatch");

// Source evidence symbol mismatch
expectInvalid(validImpact, "source_evidence_symbol_mismatch", validEvidence.map((entry) => ({
    ...entry,
    symbol: { type: entry.symbol.type, name: "ghost" }
})));

// Source evidence path mismatch
expectInvalid(validImpact, "source_evidence_path_mismatch", validEvidence.map((entry) => ({
    ...entry,
    path: "src/ghost.ts"
})));

// Missing and ambiguous impact statuses remain domain outcomes
assert.equal(validateRepositoryContextConsistency({
    graph,
    evidence: validEvidence,
    impact: withImpact({ status: "missing", targetNodeId: "function:src%2Fghost.ts:ghost" })
}).status, "ok");
assert.equal(validateRepositoryContextConsistency({
    graph,
    evidence: validEvidence,
    impact: withImpact({ status: "ambiguous", targetNodeId: "function:src%2Fghost.ts:ghost" })
}).status, "ok");

// Legacy edge without an explicit ID
const legacyGraph: RepositoryGraph = {
    nodes: [
        { id: "file:src%2Flegacy.ts", type: "file", name: "src/legacy.ts", path: "src/legacy.ts" },
        { id: "function:src%2Flegacy.ts:caller", type: "function", name: "caller", path: "src/legacy.ts" },
        { id: "function:src%2Flegacy.ts:target", type: "function", name: "target", path: "src/legacy.ts" }
    ],
    edges: [{
        from: "function:src%2Flegacy.ts:caller",
        to: "function:src%2Flegacy.ts:target",
        type: "calls",
        callSites: [{
            file: "src/legacy.ts",
            startLine: 2,
            startColumn: 5,
            endLine: 2,
            endColumn: 13,
            expression: "target()"
        }]
    }]
};
const legacyImpact = impactService.analyze(legacyGraph, {
    type: "symbol",
    symbol: { type: "function", path: "src/legacy.ts", name: "target" }
});
assert.equal(legacyImpact.status, "ok");
assert.equal(legacyImpact.paths.length, 1);
const legacyRelationship = legacyImpact.paths[0].relationships[0];
assert.ok(legacyRelationship.relationshipId.startsWith("edge:calls:"));
assert.equal(legacyRelationship.callSiteIds.length, 1);
assert.equal(legacyImpact.callSiteEvidence.length, 1);
assert.equal(validateRepositoryContextConsistency({
    graph: legacyGraph,
    evidence: [],
    impact: legacyImpact
}).status, "ok");

// Regression: a real call-site that no impact path relationship references must
// not validate as impact evidence.
const unrelatedSource = [
    "function saveOrder() {",
    "    calculateTotal(items);",
    "}",
    "function calculateTotal(values: unknown[]) { return values.length; }",
    "function unrelatedCaller() {",
    "    unrelatedTarget();",
    "}",
    "function unrelatedTarget() { return 1; }"
].join("\n");
const unrelatedGraph = buildRepositoryGraph(
    "example/repository",
    [{ path: "src/order.ts", analysis: analyzeTypeScript(unrelatedSource, "src/order.ts") }],
    []
);
const referencedImpact = impactService.analyze(unrelatedGraph, {
    type: "symbol",
    symbol: { type: "function", path: "src/order.ts", name: "calculateTotal" }
});
const unreferencedImpact = impactService.analyze(unrelatedGraph, {
    type: "symbol",
    symbol: { type: "function", path: "src/order.ts", name: "unrelatedTarget" }
});
assert.equal(referencedImpact.paths.length, 1);
assert.equal(referencedImpact.callSiteEvidence.length, 1);
assert.equal(unreferencedImpact.callSiteEvidence.length, 1);
const unreferencedEvidence = unreferencedImpact.callSiteEvidence[0];
assert.ok(unrelatedGraph.edges.some((edge) => (edge.callSites ?? []).some((site) =>
    site.file === unreferencedEvidence.file &&
    site.startLine === unreferencedEvidence.startLine &&
    site.startColumn === unreferencedEvidence.startColumn &&
    site.endLine === unreferencedEvidence.endLine &&
    site.endColumn === unreferencedEvidence.endColumn &&
    site.expression === unreferencedEvidence.expression
)), "expected the unrelated call-site to exist in the graph");
assert.equal(validateRepositoryContextConsistency({
    graph: unrelatedGraph,
    evidence: [],
    impact: referencedImpact
}).status, "ok");
expectInvalidFor(unrelatedGraph, [], {
    ...referencedImpact,
    callSiteEvidence: [unreferencedEvidence]
}, "fabricated_call_site_evidence");
expectInvalidFor(unrelatedGraph, [], {
    ...referencedImpact,
    callSiteEvidence: [...referencedImpact.callSiteEvidence, unreferencedEvidence]
}, "fabricated_call_site_evidence");
// Deterministic output
const deterministicInput = withImpact({ targetNodeId: "function:src%2Fghost.ts:ghost" });
const firstResult = validateRepositoryContextConsistency({ graph, evidence: validEvidence, impact: deterministicInput });
const secondResult = validateRepositoryContextConsistency({ graph, evidence: validEvidence, impact: deterministicInput });
assert.deepEqual(firstResult, secondResult);
assert.equal(JSON.stringify(firstResult), JSON.stringify(secondResult));

// No mutation
const before = JSON.stringify({ graph, evidence: validEvidence, impact: deterministicInput });
validateRepositoryContextConsistency({ graph, evidence: validEvidence, impact: deterministicInput });
assert.equal(JSON.stringify({ graph, evidence: validEvidence, impact: deterministicInput }), before);

console.log("repository context consistency fixtures passed");
