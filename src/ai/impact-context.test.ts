import assert from "node:assert/strict";
import { analyzeTypeScript } from "../analyzers/typescript";
import { buildRepositoryGraph, type RepositoryGraph } from "../graph/repository-graph";
import {
    ChangeImpactAnalysisService,
    type ChangeImpactAnalysisResult,
    type ChangeImpactPathRelationship
} from "../services/change-impact-analysis-service";
import { buildAiImpactContext } from "./impact-context";
import { validateRepositoryContextConsistency } from "./consistency-validator";

const TYPICAL_BUDGET = 12000;
const GENEROUS_BUDGET = 40000;
const TIGHT_BUDGET = 4000;
const CALLER_SIZES = [1, 8, 9, 20, 50];

const impactService = new ChangeImpactAnalysisService();

function analyzed(path: string, content: string) {
    return { path, analysis: analyzeTypeScript(content, path) };
}

function symbolImpact(graph: RepositoryGraph, files: { path: string; content: string }[], name: string) {
    return impactService.analyze(
        graph,
        { type: "symbol", symbol: { type: "function", path: files[0].path, name } },
        undefined,
        files
    );
}

function fanoutFixture(callerCount: number) {
    const lines = ["export function targetFn() { return 1; }"];
    for (let index = 0; index < callerCount; index++) {
        lines.push(`export function direct${index}() { return targetFn(); }`);
    }
    const files = [{ path: "src/fanout.ts", content: lines.join(" ") }];
    const graph = buildRepositoryGraph("example/repository", [analyzed(files[0].path, files[0].content)], []);
    return { graph, files, impact: symbolImpact(graph, files, "targetFn") };
}

function chainGraph() {
    const lines = [
        "export function targetFn() { return 1; }",
        "export function c0() { return targetFn(); }",
        "export function c1() { return c0(); }",
        "export function c2() { return c1(); }"
    ];
    for (let index = 0; index < 25; index++) lines.push(`export function leaf${index}() { return c1(); }`);
    const content = lines.join(" ");
    return buildRepositoryGraph("example/repository", [analyzed("src/chain.ts", content)], []);
}

function distinctRelationshipIds(impact: ChangeImpactAnalysisResult): Set<string> {
    const ids = new Set<string>();
    for (const path of impact.paths) {
        for (const relationship of path.relationships) ids.add(relationship.relationshipId);
    }
    return ids;
}

function relationshipOccurrences(impact: ChangeImpactAnalysisResult): number {
    return impact.paths.reduce((total, path) => total + path.relationships.length, 0);
}

// 1. Bounded, explicit invariant at every caller count
for (const callerCount of CALLER_SIZES) {
    const { impact } = fanoutFixture(callerCount);
    assert.equal(impact.status, "ok");
    const projection = buildAiImpactContext(impact, { budgetChars: TYPICAL_BUDGET });
    const compaction = projection.compaction;

    assert.equal(projection.status, "ok");
    assert.equal(projection.consumers.length, impact.directCallers.length + impact.transitiveConsumers.length);
    assert.equal(compaction.consumersWithDetail + compaction.detailOmittedConsumers, projection.consumers.length);
    assert.ok(compaction.omittedPaths <= compaction.detailOmittedConsumers);
    assert.equal(compaction.omittedCallSites, 0);
    assert.equal(compaction.analysisTruncated, impact.bounds.truncated);
    assert.equal(compaction.budgetChars, TYPICAL_BUDGET);
    assert.ok(JSON.stringify(projection).length <= TYPICAL_BUDGET, `budget respected for ${callerCount} callers`);
    assert.deepEqual(projection.bounds, {
        maxDepth: impact.bounds.maxDepth,
        maxResults: impact.bounds.maxResults,
        truncated: impact.bounds.truncated
    });
    assert.deepEqual(projection.totals, {
        directCallers: impact.directCallers.length,
        transitiveConsumers: impact.transitiveConsumers.length,
        testConsumers: impact.tests.length,
        paths: impact.paths.length,
        relationships: distinctRelationshipIds(impact).size,
        callSites: impact.callSiteEvidence.length,
        dependencies: impact.relatedDependencies.length
    });
    assert.equal(projection.targetNodeId, impact.targetNodeId);
    assert.deepEqual(projection.sourceEvidence, impact.sourceEvidence);
    assert.ok(projection.sourceEvidence.length > 0, "evidence is never removed by compaction");

    if (compaction.detailOmittedConsumers > 0) {
        assert.ok(projection.limitations.some((limitation) => limitation.includes("bounded")));
    } else {
        assert.equal(projection.compaction.reason, undefined);
        assert.deepEqual(projection.limitations, impact.limitations);
    }
    if (compaction.omittedPaths > 0) {
        assert.equal(compaction.reason, "impact_detail_omitted_for_context_budget");
    }
}

// 2. Budget direction: detail is preferred when it fits, bounded when it cannot
const generous = fanoutFixture(20);
const generousProjection = buildAiImpactContext(generous.impact, { budgetChars: GENEROUS_BUDGET });
assert.equal(generousProjection.compaction.detailOmittedConsumers, 0);
assert.equal(generousProjection.compaction.omittedPaths, 0);
assert.equal(generousProjection.compaction.reason, undefined);
assert.equal(generousProjection.consumers.every((consumer) => consumer.chain !== undefined), true);

// The tier-1 floor is the smallest honest projection: every consumer listed, no detail.
const floorProjection = buildAiImpactContext(generous.impact, { budgetChars: 0 });
const floorSize = JSON.stringify(floorProjection).length;
assert.equal(floorProjection.consumers.length, 20, "bounded detail never drops consumers");
assert.equal(floorProjection.compaction.consumersWithDetail, 0);
assert.equal(floorProjection.compaction.detailOmittedConsumers, 20);
assert.equal(floorProjection.compaction.omittedPaths, 20);
assert.equal(floorProjection.compaction.reason, "impact_detail_omitted_for_context_budget");
assert.ok(floorProjection.limitations.some((limitation) => limitation.includes("bounded")));
assert.equal(floorProjection.compaction.omittedCallSites, 0);

// A budget that fits the floor plus room for some detail keeps the highest-priority
// consumers detailed and declares the rest as omitted.
const constrainedBudget = floorSize + 1000;
const constrainedProjection = buildAiImpactContext(generous.impact, { budgetChars: constrainedBudget });
assert.ok(JSON.stringify(constrainedProjection).length <= constrainedBudget);
assert.ok(constrainedProjection.compaction.consumersWithDetail >= 1);
assert.ok(constrainedProjection.compaction.detailOmittedConsumers >= 1);
assert.equal(constrainedProjection.consumers.length, 20);
assert.equal(
    constrainedProjection.compaction.consumersWithDetail + constrainedProjection.compaction.detailOmittedConsumers,
    20
);
assert.equal(
    constrainedProjection.compaction.omittedPaths + constrainedProjection.compaction.consumersWithDetail,
    generous.impact.paths.length
);

// A budget below the floor degrades to the floor and says so; the request-level
// fallback for that case is covered by the AI suite.
const floorOnlyProjection = buildAiImpactContext(generous.impact, { budgetChars: TIGHT_BUDGET });
assert.equal(floorOnlyProjection.compaction.consumersWithDetail, 0);
assert.equal(floorOnlyProjection.compaction.detailOmittedConsumers, 20);
assert.ok(JSON.stringify(floorOnlyProjection).length > TIGHT_BUDGET);

// 3. Provenance: relationship metadata, nested call sites, and chain reconstruction
const provenanceFixture = fanoutFixture(20);
const provenanceProjection = buildAiImpactContext(provenanceFixture.impact, { budgetChars: TYPICAL_BUDGET });
const relationshipsById = new Map<string, ChangeImpactPathRelationship>();
for (const path of provenanceFixture.impact.paths) {
    for (const relationship of path.relationships) {
        if (!relationshipsById.has(relationship.relationshipId)) {
            relationshipsById.set(relationship.relationshipId, relationship);
        }
    }
}
const evidenceById = new Map(provenanceFixture.impact.callSiteEvidence.map((entry) => [entry.id, entry]));
for (const relationship of provenanceProjection.relationships) {
    const full = relationshipsById.get(relationship.id);
    assert.ok(full, "relationship id must exist in the full result");
    assert.equal(relationship.type, full.type);
    assert.equal(relationship.from, full.from);
    assert.equal(relationship.to, full.to);
    assert.equal(relationship.evidence, full.evidence);
    assert.equal(relationship.callSites.length, full.callSiteIds.length);
    full.callSiteIds.forEach((citedId, index) => {
        const evidence = evidenceById.get(citedId);
        assert.ok(evidence, "every cited call site must resolve to full evidence");
        assert.deepEqual(relationship.callSites[index], {
            file: evidence.file,
            startLine: evidence.startLine,
            startColumn: evidence.startColumn,
            endLine: evidence.endLine,
            endColumn: evidence.endColumn,
            expression: evidence.expression
        });
    });
}
for (const consumer of provenanceProjection.consumers) {
    if (consumer.chain === undefined) continue;
    const path = provenanceFixture.impact.paths.find(
        (candidate) => candidate.nodes[candidate.nodes.length - 1] === consumer.id
    );
    assert.ok(path, "a detailed consumer must map to a full path by its terminal node");
    // Impact paths are ordered target-ward, so each relationship's `from` is the
    // next node in the path and the last one starts at the consumer itself.
    assert.deepEqual(
        [provenanceFixture.impact.targetNodeId, ...consumer.chain.map((index) => provenanceProjection.relationships[index].from)],
        path.nodes
    );
    assert.equal(
        provenanceProjection.relationships[consumer.chain[consumer.chain.length - 1]].from,
        consumer.id
    );
    assert.ok(consumer.chain.every((index) => provenanceProjection.relationships[index] !== undefined));
    assert.equal(consumer.depth, path.depth);
    assert.equal(consumer.relationship, path.classification);
}
assert.equal(JSON.stringify(provenanceProjection).includes("impact-path:"), false, "pathId is not derived by the projector");

// 4. Pooling deduplicates shared relationships across paths
const chain = chainGraph();
const chainImpact = symbolImpact(chain, [{ path: "src/chain.ts", content: "" }], "targetFn");
const chainProjection = buildAiImpactContext(chainImpact, { budgetChars: GENEROUS_BUDGET });
assert.ok(chainImpact.paths.length > 3);
assert.ok(relationshipOccurrences(chainImpact) > distinctRelationshipIds(chainImpact).size);
assert.equal(chainProjection.relationships.length, distinctRelationshipIds(chainImpact).size);
assert.equal(chainProjection.compaction.detailOmittedConsumers, 0);
const depthThree = chainProjection.consumers.find((consumer) => consumer.depth === 3);
assert.ok(depthThree && depthThree.chain !== undefined && depthThree.chain.length === 3);

// 5. Legacy id-less edges stay valid, multi-call-site edges keep every call site
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
const legacyProjection = buildAiImpactContext(legacyImpact, { budgetChars: TYPICAL_BUDGET });
assert.equal(legacyProjection.status, "ok");
assert.equal(legacyProjection.relationships.length, 1);
assert.ok(legacyProjection.relationships[0].id.startsWith("edge:calls:"));
assert.equal(legacyProjection.relationships[0].evidence, "available");
assert.equal(legacyProjection.relationships[0].callSites.length, 1);
assert.equal(legacyProjection.relationships[0].callSites[0].expression, "target()");

const multiCallContent = [
    "function saveOrder() {",
    "    calculateTotal(items);",
    "    calculateTotal(discountedItems);",
    "}",
    "function calculateTotal(values: unknown[]) { return values.length; }"
].join(" ");
const multiCallGraph = buildRepositoryGraph("example/repository", [analyzed("src/order.ts", multiCallContent)], []);
const multiCallImpact = symbolImpact(multiCallGraph, [{ path: "src/order.ts", content: multiCallContent }], "calculateTotal");
const multiCallProjection = buildAiImpactContext(multiCallImpact, { budgetChars: TYPICAL_BUDGET });
assert.equal(multiCallProjection.relationships.length, 1);
assert.equal(multiCallProjection.relationships[0].callSites.length, 2);
assert.deepEqual(
    multiCallProjection.relationships[0].callSites.map((site) => site.expression),
    multiCallImpact.callSiteEvidence.map((entry) => entry.expression)
);

// 6. Determinism and no mutation
const deterministicFixture = fanoutFixture(50);
const deterministicInput = JSON.parse(JSON.stringify(deterministicFixture.impact));
const firstRun = buildAiImpactContext(deterministicFixture.impact, { budgetChars: TYPICAL_BUDGET });
const secondRun = buildAiImpactContext(deterministicFixture.impact, { budgetChars: TYPICAL_BUDGET });
assert.deepEqual(firstRun, secondRun);
assert.equal(JSON.stringify(firstRun), JSON.stringify(secondRun));
assert.deepEqual(JSON.parse(JSON.stringify(deterministicFixture.impact)), deterministicInput);

// 7. Empty impact: missing and ambiguous remain domain outcomes
const emptyImpact = impactService.analyze(fanoutFixture(1).graph, {
    type: "symbol",
    symbol: { type: "function", path: "src/fanout.ts", name: "missing" }
});
assert.equal(emptyImpact.status, "missing");
const emptyProjection = buildAiImpactContext(emptyImpact, { budgetChars: TYPICAL_BUDGET });
assert.equal(emptyProjection.status, "missing");
assert.deepEqual(emptyProjection.consumers, []);
assert.deepEqual(emptyProjection.relationships, []);
assert.equal(emptyProjection.compaction.detailOmittedConsumers, 0);
assert.equal(emptyProjection.compaction.omittedCallSites, 0);
assert.equal(emptyProjection.compaction.reason, undefined);
assert.deepEqual(emptyProjection.totals, {
    directCallers: 0,
    transitiveConsumers: 0,
    testConsumers: 0,
    paths: 0,
    relationships: 0,
    callSites: 0,
    dependencies: 0
});

const ambiguousGraph: RepositoryGraph = {
    nodes: [
        { id: "function:one:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" },
        { id: "function:two:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" }
    ],
    edges: []
};
const ambiguousImpact = impactService.analyze(ambiguousGraph, {
    type: "symbol",
    symbol: { type: "function", path: "src/duplicate.ts", name: "duplicate" }
});
assert.equal(ambiguousImpact.status, "ambiguous");
assert.equal(buildAiImpactContext(ambiguousImpact, { budgetChars: TYPICAL_BUDGET }).status, "ambiguous");
const tinyBudgetEmpty = buildAiImpactContext(emptyImpact, { budgetChars: 0 });
assert.equal(tinyBudgetEmpty.status, "missing");
assert.equal(tinyBudgetEmpty.compaction.reason, undefined);

// 8. The projector consumes an already-validated result
const validationFixture = fanoutFixture(9);
const validation = validateRepositoryContextConsistency({
    graph: validationFixture.graph,
    evidence: [],
    impact: validationFixture.impact
});
assert.equal(validation.status, "ok");
const validatedProjection = buildAiImpactContext(validationFixture.impact, { budgetChars: TYPICAL_BUDGET });
assert.equal(validatedProjection.status, "ok");
assert.equal(validatedProjection.consumers.length, 9);

console.log("AI impact context fixtures passed");
