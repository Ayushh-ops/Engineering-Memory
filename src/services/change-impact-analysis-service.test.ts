import assert from "node:assert/strict";
import type { RepositoryGraph } from "../graph/repository-graph";
import { RepositorySourceEvidenceService } from "./repository-source-evidence-service";
import { ChangeImpactAnalysisService } from "./change-impact-analysis-service";
import { computeGraphHealth } from "../routes/health";

const graph: RepositoryGraph = {
    nodes: [
        { id: "function:src%2Ftarget.ts:target", type: "function", name: "target", path: "src/target.ts" },
        { id: "function:src%2Fdirect.ts:direct", type: "function", name: "direct", path: "src/direct.ts" },
        { id: "function:src%2Ftransitive.ts:middle", type: "function", name: "middle", path: "src/transitive.ts" },
        { id: "function:src%2Froot.ts:root", type: "function", name: "root", path: "src/root.ts" },
        { id: "function:tests%2Ftarget.test.ts:testTarget", type: "function", name: "testTarget", path: "tests/target.test.ts" },
        { id: "function:src%2Fisolated.ts:isolated", type: "function", name: "isolated", path: "src/isolated.ts" }
    ],
    edges: [
        { from: "function:src%2Fdirect.ts:direct", to: "function:src%2Ftarget.ts:target", type: "calls" },
        { from: "function:src%2Ftransitive.ts:middle", to: "function:src%2Fdirect.ts:direct", type: "calls" },
        { from: "function:src%2Froot.ts:root", to: "function:src%2Ftransitive.ts:middle", type: "calls" },
        { from: "function:tests%2Ftarget.test.ts:testTarget", to: "function:src%2Ftarget.ts:target", type: "calls" },
        { from: "function:src%2Ftarget.ts:target", to: "function:src%2Froot.ts:root", type: "calls" }
    ]
};

const service = new ChangeImpactAnalysisService();
const target = { type: "symbol" as const, symbol: { type: "function" as const, path: "src/target.ts", name: "target" } };

const result = service.analyze(graph, target);
assert.equal(result.status, "ok");
assert.deepEqual(result.directCallers.map((item) => item.symbol.name), ["direct", "testTarget"]);
assert.deepEqual(result.transitiveConsumers.map((item) => `${item.symbol.name}:${item.depth}`), ["middle:2", "root:3"]);
assert.equal(result.bounds.truncated, false);
assert.equal(result.directCallers[0]?.relationship, "direct-caller");
assert.equal(result.transitiveConsumers[0]?.relationship, "transitive-consumer");
assert.deepEqual(result.tests.map((item) => ({
    path: item.path ?? item.symbol?.path,
    relationship: item.relationship,
    classification: item.classification
})), [{
    path: "tests/target.test.ts",
    relationship: "test-consumer",
    classification: "path-convention"
}]);
assert.equal(result.reviewCandidates[0]?.reason, "should-be-reviewed");
assert.equal(result.reviewCandidates[1]?.reason, "validation-candidate");
assert.equal(result.reviewCandidates[1]?.evidence, "path-convention");
assert.ok(Array.isArray(result.reasons));
assert.ok(result.reasons.some((r) => r.label === "Dependents" && r.value.includes("files depend on it")));
assert.ok(result.reasons.some((r) => r.label === "Test coverage" && r.value.includes("test file")));

const bounded = service.analyze(graph, target, { maxDepth: 2, maxResults: 10 });
assert.deepEqual(bounded.transitiveConsumers.map((item) => item.symbol.name), ["middle"]);
assert.equal(bounded.bounds.truncated, true);

const limited = service.analyze(graph, target, { maxDepth: 3, maxResults: 1 });
assert.deepEqual(limited.directCallers.map((item) => item.symbol.name), ["direct"]);
assert.deepEqual(limited.transitiveConsumers, []);
assert.equal(limited.bounds.truncated, true);

const cyclic = service.analyze(graph, target, { maxDepth: 10, maxResults: 10 });
assert.deepEqual(cyclic.transitiveConsumers.map((item) => item.symbol.name), ["middle", "root"]);
assert.equal(cyclic.bounds.truncated, false);

const missing = service.analyze(graph, {
    type: "symbol",
    symbol: { type: "function", path: "src/missing.ts", name: "missing" }
});
assert.equal(missing.status, "missing");
assert.deepEqual(missing.directCallers, []);

const ambiguousGraph: RepositoryGraph = {
    nodes: [
        { id: "function:one:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" },
        { id: "function:two:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" }
    ],
    edges: []
};
const ambiguous = service.analyze(ambiguousGraph, {
    type: "symbol",
    symbol: { type: "function", path: "src/duplicate.ts", name: "duplicate" }
});
assert.equal(ambiguous.status, "ambiguous");

const noCallers = service.analyze(graph, {
    type: "symbol",
    symbol: { type: "function", path: "src/isolated.ts", name: "isolated" }
});
assert.deepEqual(noCallers.directCallers, []);
assert.deepEqual(noCallers.transitiveConsumers, []);
assert.equal(noCallers.bounds.truncated, false);

const fileGraph: RepositoryGraph = {
    nodes: [
        { id: "file:src%2Ftarget.ts", type: "file", name: "src/target.ts", path: "src/target.ts" },
        { id: "file:src%2Fdependency.ts", type: "file", name: "src/dependency.ts", path: "src/dependency.ts" },
        { id: "file:src%2Fconsumer.ts", type: "file", name: "src/consumer.ts", path: "src/consumer.ts" }
    ],
    edges: [
        { from: "file:src%2Ftarget.ts", to: "file:src%2Fdependency.ts", type: "imports" },
        { from: "file:src%2Fconsumer.ts", to: "file:src%2Ftarget.ts", type: "imports" }
    ]
};
const fileResult = service.analyze(fileGraph, { type: "file", path: "src/target.ts" });
assert.equal(fileResult.status, "ok");
assert.deepEqual(fileResult.relatedDependencies.map((dependency) => ({
    path: dependency.path,
    relationship: dependency.relationship,
    evidence: dependency.evidence
})), [
    { path: "src/dependency.ts", relationship: "direct-import", evidence: "imports-edge" },
    { path: "src/consumer.ts", relationship: "reverse-import", evidence: "imports-edge" }
]);
assert.deepEqual(fileResult.reviewCandidates.map((candidate) => candidate.relationship), ["direct-import", "reverse-import"]);
assert.equal(fileResult.directCallers.length, 1);
assert.equal(fileResult.directCallers[0].symbol.path, "src/consumer.ts");
assert.equal(fileResult.paths.length, 1);
assert.equal(fileResult.paths[0].classification, "direct-caller");

const testMappingGraph: RepositoryGraph = {
    nodes: [
        { id: "file:src%2Fservice.ts", type: "file", name: "src/service.ts", path: "src/service.ts" },
        { id: "file:tests%2Fservice.test.ts", type: "file", name: "tests/service.test.ts", path: "tests/service.test.ts" },
        { id: "file:tests%2Fintegration.spec.ts", type: "file", name: "tests/integration.spec.ts", path: "tests/integration.spec.ts" },
        { id: "file:src%2Funrelated.ts", type: "file", name: "src/unrelated.ts", path: "src/unrelated.ts" }
    ],
    edges: [
        { from: "file:tests%2Fintegration.spec.ts", to: "file:src%2Fservice.ts", type: "imports" }
    ]
};
const testMappingResult = service.analyze(testMappingGraph, { type: "file", path: "src/service.ts" });
assert.deepEqual(testMappingResult.tests.map((t) => t.path).sort(), [
    "tests/integration.spec.ts",
    "tests/service.test.ts"
]);

const evidenceResult = service.analyze(graph, target, undefined, [
    { path: "src/target.ts", content: "export function target() { return 1; }" },
    { path: "src/direct.ts", content: "export function direct() { return target(); }" },
    { path: "src/transitive.ts", content: "export function middle() { return direct(); }" },
    { path: "tests/target.test.ts", content: "export function testTarget() { return target(); }" }
]);
assert.ok(evidenceResult.sourceEvidence.some((evidence) => evidence.symbol.name === "target"));
assert.ok(evidenceResult.sourceEvidence.some((evidence) => evidence.symbol.name === "direct"));
assert.ok(evidenceResult.sourceEvidence.some((evidence) => evidence.symbol.name === "middle"));
assert.ok(evidenceResult.sourceEvidence.length <= 8);

const boundedEvidenceResult = new ChangeImpactAnalysisService(new RepositorySourceEvidenceService({
    maxSnippets: 2,
    maxBytesPerSnippet: 20,
    maxTotalBytes: 30
})).analyze(graph, target, undefined, [
    { path: "src/target.ts", content: "export function target() { return 1; }" },
    { path: "src/direct.ts", content: "export function direct() { return target(); }" },
    { path: "src/transitive.ts", content: "export function middle() { return direct(); }" }
]);
assert.ok(boundedEvidenceResult.sourceEvidence.length <= 2);
assert.ok(boundedEvidenceResult.sourceEvidence.every((evidence) => Buffer.byteLength(evidence.code, "utf8") <= 20));

// Health summary tests
const healthTestGraph: RepositoryGraph = {
    nodes: [
        { id: "file:src%2Fa.ts", type: "file", name: "src/a.ts", path: "src/a.ts" },
        { id: "file:src%2Fb.ts", type: "file", name: "src/b.ts", path: "src/b.ts" },
        { id: "file:src%2Fc.ts", type: "file", name: "src/c.ts", path: "src/c.ts" },
        { id: "file:src%2Funused.ts", type: "file", name: "src/unused.ts", path: "src/unused.ts" },
        { id: "file:src%2Findex.ts", type: "file", name: "src/index.ts", path: "src/index.ts" },
        { id: "file:src%2Fgod.ts", type: "file", name: "src/god.ts", path: "src/god.ts" },
        ...Array.from({ length: 16 }, (_, i) => ({
            id: `file:src%2Fsub${i}.ts`,
            type: "file" as const,
            name: `src/sub${i}.ts`,
            path: `src/sub${i}.ts`
        }))
    ],
    edges: [
        // a <-> b circular
        { from: "file:src%2Fa.ts", to: "file:src%2Fb.ts", type: "imports" },
        { from: "file:src%2Fb.ts", to: "file:src%2Fa.ts", type: "imports" },
        // god.ts imports 16 files
        ...Array.from({ length: 16 }, (_, i) => ({
            from: "file:src%2Fgod.ts",
            to: `file:src%2Fsub${i}.ts`,
            type: "imports" as const
        }))
    ]
};

const health = computeGraphHealth(healthTestGraph);
assert.equal(health.circularImports.length, 1);
assert.deepEqual(health.circularImports[0], ["src/a.ts", "src/b.ts"]);
assert.ok(health.unusedFiles.includes("src/unused.ts"));
assert.ok(!health.unusedFiles.includes("src/index.ts"));
assert.equal(health.godFiles.length, 1);
assert.equal(health.godFiles[0].path, "src/god.ts");
assert.equal(health.godFiles[0].importCount, 16);

console.log("change impact analysis fixtures passed");