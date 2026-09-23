import assert from "node:assert/strict";
import express, { type Router } from "express";
import type { RepositoryGraph } from "../graph/repository-graph";
import { ChangeImpactAnalysisService } from "../services/change-impact-analysis-service";
import { createImpactRouter } from "./impact";

const graph: RepositoryGraph = {
    nodes: [
        { id: "file:src%2Ftarget.ts", type: "file", name: "src/target.ts", path: "src/target.ts" },
        { id: "file:src%2Fdirect.ts", type: "file", name: "src/direct.ts", path: "src/direct.ts" },
        { id: "file:src%2Ftransitive.ts", type: "file", name: "src/transitive.ts", path: "src/transitive.ts" },
        { id: "file:src%2Froot.ts", type: "file", name: "src/root.ts", path: "src/root.ts" },
        { id: "file:tests%2Ftarget.test.ts", type: "file", name: "tests/target.test.ts", path: "tests/target.test.ts" },
        { id: "function:src%2Ftarget.ts:target", type: "function", name: "target", path: "src/target.ts" },
        { id: "function:src%2Fdirect.ts:direct", type: "function", name: "direct", path: "src/direct.ts" },
        { id: "function:src%2Ftransitive.ts:middle", type: "function", name: "middle", path: "src/transitive.ts" },
        { id: "function:src%2Froot.ts:root", type: "function", name: "root", path: "src/root.ts" },
        { id: "function:tests%2Ftarget.test.ts:testTarget", type: "function", name: "testTarget", path: "tests/target.test.ts" }
    ],
    edges: [
        { from: "function:src%2Fdirect.ts:direct", to: "function:src%2Ftarget.ts:target", type: "calls" },
        { from: "function:src%2Ftransitive.ts:middle", to: "function:src%2Fdirect.ts:direct", type: "calls" },
        { from: "function:src%2Froot.ts:root", to: "function:src%2Ftransitive.ts:middle", type: "calls" },
        { from: "function:tests%2Ftarget.test.ts:testTarget", to: "function:src%2Ftarget.ts:target", type: "calls" },
        { from: "function:src%2Ftarget.ts:target", to: "function:src%2Froot.ts:root", type: "calls" }
    ]
};

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

const ambiguousGraph: RepositoryGraph = {
    nodes: [
        { id: "function:one:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" },
        { id: "function:two:duplicate", type: "function", name: "duplicate", path: "src/duplicate.ts" }
    ],
    edges: []
};

const symbolTarget = {
    type: "symbol" as const,
    symbol: { type: "function" as const, path: "src/target.ts", name: "target" }
};

const evidenceFiles = [
    { path: "src/target.ts", content: "export function target() { return 1; }" },
    { path: "src/direct.ts", content: "export function direct() { return target(); }" },
    { path: "src/transitive.ts", content: "export function middle() { return direct(); }" }
];

const service = new ChangeImpactAnalysisService();

interface EndpointResult {
    status: number;
    body: Record<string, unknown>;
}

async function startServer(router: Router): Promise<{ port: number; close: () => void }> {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    return {
        port: (server.address() as { port: number }).port,
        close: () => server.close()
    };
}

function request(port: number, body: unknown): Promise<EndpointResult> {
    return fetch(`http://127.0.0.1:${port}/api/repositories/graph/impact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }).then(async (response) => ({
        status: response.status,
        body: await response.json() as Record<string, unknown>
    }));
}

async function main(): Promise<void> {
    const server = await startServer(createImpactRouter());
    const port = server.port;
    const endpoint = (body: unknown): Promise<EndpointResult> => request(port, body);

    try {
        // 1. The response is the service result itself, unchanged and unreshaped.
        const expected = JSON.parse(JSON.stringify(service.analyze(graph, symbolTarget))) as Record<string, unknown>;
        const ok = await endpoint({ graph, request: { target: symbolTarget } });
        assert.equal(ok.status, 200);
        assert.deepEqual(ok.body, expected);
        assert.equal(ok.body.status, "ok");
        assert.equal(ok.body.targetNodeId, "function:src%2Ftarget.ts:target");
        assert.deepEqual(ok.body.bounds, { maxDepth: 3, maxResults: 50, truncated: false });

        // 2. Deterministic ordering and byte-identical repeated responses.
        const repeated = await endpoint({ graph, request: { target: symbolTarget } });
        assert.equal(JSON.stringify(ok.body), JSON.stringify(repeated.body));
        assert.deepEqual(
            (ok.body.directCallers as Array<{ symbol: { name: string } }>).map((caller) => caller.symbol.name),
            ["direct", "testTarget"]
        );
        assert.deepEqual(
            (ok.body.transitiveConsumers as Array<{ symbol: { name: string }; depth: number }>)
                .map((consumer) => `${consumer.symbol.name}:${consumer.depth}`),
            ["middle:2", "root:3"]
        );
        assert.deepEqual(
            (ok.body.tests as Array<{ symbol: { path: string } }>).map((test) => test.symbol.path),
            ["tests/target.test.ts"]
        );

        // 3. Caller-supplied files produce bounded source evidence and stay graph-consistent.
        const withFiles = await endpoint({
            graph,
            request: { target: symbolTarget, limits: { maxDepth: 3, maxResults: 50 } },
            files: evidenceFiles
        });
        assert.equal(withFiles.status, 200);
        const evidence = withFiles.body.sourceEvidence as Array<{ symbol: { name: string } }>;
        assert.ok(evidence.some((entry) => entry.symbol.name === "target"));
        assert.ok(evidence.some((entry) => entry.symbol.name === "direct"));
        assert.ok(evidence.some((entry) => entry.symbol.name === "middle"));
        assert.ok(evidence.length <= 8);
        assert.equal(
            (withFiles.body.limitations as string[]).some((limitation) => limitation.includes("Source evidence was not requested")),
            false
        );

        // 4. Without files, source evidence is empty and the limitation states why.
        assert.deepEqual(ok.body.sourceEvidence, []);
        assert.equal(
            (ok.body.limitations as string[]).some((limitation) => limitation.includes("Source evidence was not requested")),
            true
        );

        // 5. File targets return dependency facts and omit the symbol-only target node id.
        const fileTarget = { type: "file" as const, path: "src/target.ts" };
        const fileResponse = await endpoint({ graph: fileGraph, request: { target: fileTarget } });
        assert.equal(fileResponse.status, 200);
        assert.equal(fileResponse.body.status, "ok");
        assert.equal("targetNodeId" in fileResponse.body, false);
        assert.deepEqual(
            (fileResponse.body.relatedDependencies as Array<{ path: string; relationship: string }>)
                .map((dependency) => `${dependency.relationship}:${dependency.path}`),
            ["direct-import:src/dependency.ts", "reverse-import:src/consumer.ts"]
        );

        // 6. Missing and ambiguous targets stay 200 domain outcomes with honest structure.
        const missing = await endpoint({
            graph,
            request: { target: { type: "symbol", symbol: { type: "function", path: "src/missing.ts", name: "missing" } } }
        });
        assert.equal(missing.status, 200);
        assert.equal(missing.body.status, "missing");
        assert.deepEqual(missing.body.directCallers, []);
        assert.deepEqual(missing.body.transitiveConsumers, []);
        assert.deepEqual(missing.body.bounds, { maxDepth: 3, maxResults: 50, truncated: false });

        const ambiguous = await endpoint({
            graph: ambiguousGraph,
            request: { target: { type: "symbol", symbol: { type: "function", path: "src/duplicate.ts", name: "duplicate" } } }
        });
        assert.equal(ambiguous.status, 200);
        assert.equal(ambiguous.body.status, "ambiguous");

        // 7. Limits: defaults, custom values, truncation, and boundary-valid extremes.
        const bounded = await endpoint({
            graph,
            request: { target: symbolTarget, limits: { maxDepth: 2, maxResults: 10 } }
        });
        assert.equal(bounded.status, 200);
        assert.deepEqual(bounded.body.bounds, { maxDepth: 2, maxResults: 10, truncated: true });
        assert.deepEqual(
            (bounded.body.transitiveConsumers as Array<{ symbol: { name: string } }>).map((consumer) => consumer.symbol.name),
            ["middle"]
        );

        // maxResults 0 is valid: the service explicitly allows >= 0.
        const zeroResults = await endpoint({ graph, request: { target: symbolTarget, limits: { maxResults: 0 } } });
        assert.equal(zeroResults.status, 200);
        assert.deepEqual(zeroResults.body.bounds, { maxDepth: 3, maxResults: 0, truncated: true });
        assert.deepEqual(zeroResults.body.directCallers, []);
        assert.deepEqual(zeroResults.body.transitiveConsumers, []);

        const boundaryLimits = await endpoint({
            graph,
            request: { target: symbolTarget, limits: { maxDepth: 10, maxResults: 500 } }
        });
        assert.equal(boundaryLimits.status, 200);
        assert.deepEqual(boundaryLimits.body.bounds, { maxDepth: 10, maxResults: 500, truncated: false });

        const singleResult = await endpoint({ graph, request: { target: symbolTarget, limits: { maxResults: 1 } } });
        assert.equal(singleResult.status, 200);
        assert.deepEqual(
            (singleResult.body.directCallers as Array<{ symbol: { name: string } }>).map((caller) => caller.symbol.name),
            ["direct"]
        );
        assert.deepEqual(singleResult.body.transitiveConsumers, []);
        assert.equal((singleResult.body.bounds as { truncated: boolean }).truncated, true);

        // 8. Unsupported, malformed, and missing request inputs.
        const commitTarget = await endpoint({ graph, request: { target: { type: "commit", sha: "abc123" } } });
        assert.equal(commitTarget.status, 400);
        assert.match(String(commitTarget.body.error), /Commit targets are not supported/);

        const unsupportedSymbolType = await endpoint({
            graph,
            request: { target: { type: "symbol", symbol: { type: "variable", path: "src/target.ts", name: "target" } } }
        });
        assert.equal(unsupportedSymbolType.status, 400);
        assert.match(String(unsupportedSymbolType.body.error), /valid file or symbol target/);

        const emptyTargets = [
            {},
            { target: { type: "file", path: "   " } },
            { target: { type: "symbol", symbol: { type: "function", path: "src/target.ts" } } },
            { target: { type: "branch", name: "main" } }
        ];
        for (const request2 of emptyTargets) {
            const response = await endpoint({ graph, request: request2 });
            assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(request2)}`);
            assert.match(String(response.body.error), /valid file or symbol target/);
        }

        const invalidGraph = await endpoint({ graph: { nodes: [] }, request: { target: symbolTarget } });
        assert.equal(invalidGraph.status, 400);
        assert.match(String(invalidGraph.body.error), /valid graph and impact request/);

        const missingRequest = await endpoint({ graph });
        assert.equal(missingRequest.status, 400);
        assert.match(String(missingRequest.body.error), /valid graph and impact request/);

        const arrayBody = await endpoint([1, 2, 3]);
        assert.equal(arrayBody.status, 400);
        assert.match(String(arrayBody.body.error), /Malformed request body/);

        // 9. Invalid limits, including the HTTP boundary caps.
        const invalidLimits: Array<Record<string, unknown>> = [
            { maxDepth: 0 },
            { maxDepth: -1 },
            { maxDepth: 1.5 },
            { maxDepth: "3" },
            { maxDepth: 11 },
            { maxResults: -1 },
            { maxResults: 1.5 },
            { maxResults: 501 },
            { maxFiles: 5 }
        ];
        for (const limits of invalidLimits) {
            const response = await endpoint({ graph, request: { target: symbolTarget, limits } });
            assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(limits)}`);
            assert.equal(typeof response.body.error, "string");
        }

        const arrayLimits = await endpoint({ graph, request: { target: symbolTarget, limits: [1, 2] } });
        assert.equal(arrayLimits.status, 400);
        assert.match(String(arrayLimits.body.error), /limits/);

        // 10. Files validation.
        const tooManyFiles = await endpoint({
            graph,
            request: { target: symbolTarget },
            files: Array.from({ length: 21 }, (_value, index) => ({ path: `src/file${index}.ts`, content: "" }))
        });
        assert.equal(tooManyFiles.status, 400);
        assert.match(String(tooManyFiles.body.error), /at most 20 entries/);

        const duplicateFiles = await endpoint({
            graph,
            request: { target: symbolTarget },
            files: [
                { path: "src/target.ts", content: "export function target() { return 1; }" },
                { path: "src/target.ts", content: "export function target() { return 2; }" }
            ]
        });
        assert.equal(duplicateFiles.status, 400);
        assert.match(String(duplicateFiles.body.error), /unique/);

        const missingContent = await endpoint({
            graph,
            request: { target: symbolTarget },
            files: [{ path: "src/target.ts" }]
        });
        assert.equal(missingContent.status, 400);
        assert.match(String(missingContent.body.error), /non-empty path and string content/);

        const nonArrayFiles = await endpoint({ graph, request: { target: symbolTarget }, files: {} });
        assert.equal(nonArrayFiles.status, 400);
        assert.match(String(nonArrayFiles.body.error), /files must be an array/);

        // 11. The response is the full deterministic result: no raw graph and no AI-only fields.
        assert.equal("nodes" in ok.body, false);
        assert.equal("edges" in ok.body, false);
        for (const aiOnlyField of ["answer", "citations", "confidence", "missingData", "compaction", "totals", "consumers"]) {
            assert.equal(aiOnlyField in ok.body, false, `unexpected AI field ${aiOnlyField}`);
        }
        assert.deepEqual(Object.keys(ok.body).sort(), Object.keys(service.analyze(graph, symbolTarget)).sort());

        // 12. The consistency gate is fail-closed: an inconsistent derived result is never served.
        const inconsistentResult = {
            ...service.analyze(graph, symbolTarget),
            targetNodeId: "function:src%2Fghost.ts:ghost"
        };
        const stubServer = await startServer(createImpactRouter({ analyze: () => inconsistentResult }));
        try {
            const rejected = await request(stubServer.port, { graph, request: { target: symbolTarget } });
            assert.equal(rejected.status, 400);
            assert.match(String(rejected.body.error), /graph-consistent/);
            assert.deepEqual(rejected.body.missingData, ["impact_target_node_missing"]);
            assert.equal("status" in rejected.body, false);
        } finally {
            stubServer.close();
        }

        console.log("impact route fixtures passed");
    } finally {
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
